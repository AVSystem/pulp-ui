import { msg, t } from '@lingui/core/macro';
import {
  Button,
  DropdownItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AppliedFilters,
  CompoundFilter,
  DateComponent,
  EmptyStateFilter,
  EmptyStateNoData,
  ExpandableRow,
  ListErrorState,
  LoadingSpinner,
  PulpPagination,
  SortTable,
  Table,
} from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import {
  ListItemActions,
  RowActionsColumn,
} from 'src/components/list-item-actions';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { requestErrorDescription } from 'src/utilities/request-error';
import type { PluginDescriptor, TabDef } from '../descriptor';
import { useDistributionPermits } from '../distributions/use-distribution-permission';
import { PermissionsNotice } from '../list/list-frame';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { ServingFix } from '../publish/serving-fix';
import {
  distributionEditPath,
  distributionPath,
  newDistributionPath,
} from '../route-patterns';
import {
  type ServedDistribution,
  useServedDistributions,
} from '../serving/use-served-distributions';
import { DistributionSnippets } from '../snippets/distribution-snippets';

// The page, its size, the order and the filters of the tab. They are held here
// and not in the address: the tab shows the few distributions of one
// repository, which are all read at once, and a filter or an order only cuts
// and sorts them in the browser.
interface TabParams {
  [key: string]: string | number | undefined;
  page: number;
  page_size: number;
  sort: string;
  name__icontains?: string;
  base_path__icontains?: string;
}

const DEFAULT_PARAMS: TabParams = { page: 1, page_size: 10, sort: 'name' };

const NEEDED_PERMISSIONS = ['change'] as const;

const FILTER_PARAMS = ['name__icontains', 'base_path__icontains'] as const;

// The field of a distribution each sortable column orders by.
const SORT_FIELDS = {
  name: (row: DistributionBase) => row.name,
  base_path: (row: DistributionBase) => row.base_path,
  pulp_created: (row: DistributionBase) => row.pulp_created ?? '',
};

type SortField = keyof typeof SORT_FIELDS;

function isSortField(field: string): field is SortField {
  return field in SORT_FIELDS;
}

// Whether the text is part of the value, ignoring case.
const contains = (value: string, text: string) =>
  value.toLowerCase().includes(text.toLowerCase());

// The rows the filters let through, in the order asked for.
function shown(
  rows: readonly ServedDistribution[],
  params: TabParams,
): ServedDistribution[] {
  const descending = params.sort.startsWith('-');
  const field = params.sort.replace(/^-/, '');
  const valueOf = isSortField(field) ? SORT_FIELDS[field] : SORT_FIELDS.name;

  return rows
    .filter(
      ({ row }) =>
        (params.name__icontains === undefined ||
          contains(row.name, params.name__icontains)) &&
        (params.base_path__icontains === undefined ||
          contains(row.base_path, params.base_path__icontains)),
    )
    .sort((a, b) => {
      const order = valueOf(a.row).localeCompare(valueOf(b.row));
      return descending ? -order : order;
    });
}

interface Props {
  repository: RepositoryBase;
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// Every distribution that serves a repository, bound to it, to one of its
// publications or to one of its versions, with the URL the server reports for
// it, what it serves and the plugin's client command for it. The
// rows come from the index of the plugin's distributions that the other screens
// share, so the tab sends no request of its own per row.
export const DistributionsTab = ({ repository, plugin, descriptor }: Props) => {
  const { distribution, publication } = descriptor;
  if (!distribution) {
    throw new Error(
      'The descriptor declares no distribution, which the Distributions tab needs',
    );
  }
  // A row opens to show the client configuration the plugin declares for it.
  const expandable = (distribution.snippets?.length ?? 0) > 0;
  const serving = useServedDistributions({
    plugin,
    distribution: distribution.entity,
    publication,
    repository,
  });
  const { hasPermission } = useAppContext();
  const navigate = useNavigate();
  // Offered to a user who may add distributions of the plugin; Pulp decides the
  // request. The form opens with this repository chosen.
  const addPermission = PLUGIN_MANIFESTS.find(
    (manifest) => manifest.plugin === plugin,
  )?.permissions.distribution.add;
  const createButton =
    addPermission !== undefined && hasPermission(addPermission) ? (
      <Button
        variant='primary'
        onClick={() => navigate(newDistributionPath(plugin, repository.name))}
      >
        {t`Create distribution`}
      </Button>
    ) : undefined;
  const [params, setParams] = useState<TabParams>(DEFAULT_PARAMS);
  const [inputText, setInputText] = useState('');

  const rows = useMemo(
    () => shown(serving.distributions ?? [], params),
    [serving.distributions, params],
  );
  const start = (params.page - 1) * params.page_size;
  const pageRows = rows.slice(start, start + params.page_size);
  // What the user may do with each row: the change permission held on every
  // distribution of the plugin, or on this one through a role on it.
  const { permits, failure: permissionsFailure } = useDistributionPermits({
    rows: pageRows.map(() => ({ plugin })),
    needed: NEEDED_PERMISSIONS,
    rowsShown: pageRows.length > 0,
  });
  const changeable = pageRows.map(({ row }) =>
    permits('change', { pulp_href: row.pulp_href, plugin }),
  );
  const anyRowAction = changeable.some(Boolean);

  if (serving.status === 'error') {
    return (
      <ListErrorState
        title={t`Distributions could not be displayed.`}
        message={requestErrorDescription(serving.error)}
        onRetry={serving.retry}
      />
    );
  }
  if (!serving.distributions) {
    return <LoadingSpinner />;
  }
  if (serving.distributions.length === 0) {
    return (
      <EmptyStateNoData
        title={t`No distribution serves this repository`}
        description={t`Clients cannot download its content until a distribution serves it.`}
        button={createButton}
      />
    );
  }

  const filterConfig = [
    { id: 'name__icontains', title: t`Name` },
    { id: 'base_path__icontains', title: t`Base path` },
  ];
  const filterSet = FILTER_PARAMS.some((key) => params[key] !== undefined);
  const headers = [
    ...(expandable ? [{ id: 'expand', title: '', type: 'none' }] : []),
    { id: 'name', title: t`Name`, type: 'alpha' },
    { id: 'base_path', title: t`Base path`, type: 'alpha' },
    { id: 'url', title: t`URL`, type: 'none' },
    { id: 'pulp_created', title: t`Created`, type: 'numeric' },
    ...(anyRowAction ? [{ id: 'actions', title: '', type: 'none' }] : []),
  ];
  const updateParams = (next: Partial<TabParams>) =>
    setParams({ ...DEFAULT_PARAMS, ...next } as TabParams);

  return (
    <>
      {permissionsFailure ? (
        <PermissionsNotice
          description={permissionsFailure.description}
          retry={permissionsFailure.retry}
        />
      ) : null}
      <div className='pulp-toolbar' data-cy='DistributionsTab'>
        <Toolbar>
          <ToolbarContent>
            <ToolbarGroup>
              <ToolbarItem>
                <CompoundFilter
                  inputText={inputText}
                  onChange={setInputText}
                  updateParams={updateParams}
                  params={params}
                  filterConfig={filterConfig}
                />
              </ToolbarItem>
            </ToolbarGroup>
            {createButton ? <ToolbarItem>{createButton}</ToolbarItem> : null}
          </ToolbarContent>
        </Toolbar>
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={rows.length}
          isTop
        />
      </div>
      <div>
        <AppliedFilters
          updateParams={(next) => {
            setInputText('');
            updateParams(next);
          }}
          params={params}
          ignoredParams={['page', 'page_size', 'sort']}
          niceNames={Object.fromEntries(
            filterConfig.map(({ id, title }) => [id, title]),
          )}
        />
      </div>
      {rows.length === 0 && filterSet ? (
        <EmptyStateFilter
          clearAllFilters={() => {
            setInputText('');
            setParams({ ...DEFAULT_PARAMS, sort: params.sort });
          }}
        />
      ) : (
        <Table aria-label={t`Distributions`}>
          <SortTable
            options={{ headers }}
            params={params}
            updateParams={updateParams}
          />
          <RowActionsColumn.Provider value={anyRowAction}>
            {pageRows.map(({ row, served }, position) => {
              const cells = (
                <>
                  <Td>
                    <Link to={distributionPath(plugin, row.name)}>
                      {row.name}
                    </Link>
                  </Td>
                  <Td>{row.base_path}</Td>
                  <Td>
                    <DistributionURL
                      distribution={{
                        url: row.base_url ?? null,
                        state: served,
                      }}
                      isPublic={row.content_guard === null}
                    />
                    <ServingFix
                      plugin={plugin}
                      distribution={row}
                      served={served}
                      repositoryHref={repository.pulp_href}
                    />
                  </Td>
                  <Td>
                    <DateComponent date={row.pulp_created ?? ''} />
                  </Td>
                  <ListItemActions
                    kebabItems={
                      changeable[position]
                        ? [
                            <DropdownItem
                              key='edit'
                              onClick={() =>
                                navigate(distributionEditPath(plugin, row.name))
                              }
                            >
                              {t`Edit`}
                            </DropdownItem>,
                          ]
                        : []
                    }
                  />
                </>
              );

              return expandable ? (
                <ExpandableRow
                  key={row.pulp_href}
                  rowIndex={position}
                  colSpan={headers.length}
                  expandableRowContent={
                    <DistributionSnippets
                      plugin={plugin}
                      descriptor={descriptor}
                      distribution={row}
                      repositoryName={repository.name}
                    />
                  }
                >
                  {cells}
                </ExpandableRow>
              ) : (
                <Tbody key={row.pulp_href}>
                  <Tr>{cells}</Tr>
                </Tbody>
              );
            })}
          </RowActionsColumn.Provider>
        </Table>
      )}
      {rows.length > 0 ? (
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={rows.length}
        />
      ) : null}
    </>
  );
};

// The Distributions tab as a plugin declares it among its tabs.
export const distributionsTab = <
  Row extends RepositoryBase,
>(): TabDef<Row> => ({
  id: 'distributions',
  label: msg`Distributions`,
  render: ({ repository, plugin, descriptor }) => (
    <DistributionsTab
      repository={repository}
      plugin={plugin}
      descriptor={descriptor}
    />
  ),
});
