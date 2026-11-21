import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import {
  DropdownItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useMemo, useState } from 'react';
import { useAppContext } from 'src/app-context';
import {
  type AlertType,
  AppliedFilters,
  ClipboardCopy,
  CompoundFilter,
  DateComponent,
  EmptyStateFilter,
  EmptyStateNoData,
  ListErrorState,
  LoadingSpinner,
  PulpPagination,
  SortTable,
  Table,
} from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import { ListItemActions } from 'src/components/list-item-actions';
import {
  type ServingDistribution,
  useRepositoryDistributions,
} from 'src/entities/plugin/distribution';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { requestErrorDescription } from 'src/utilities/request-error';
import type { PluginDescriptor, TabDef } from '../descriptor';

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
  rows: readonly ServingDistribution<DistributionBase>[],
  params: TabParams,
): ServingDistribution<DistributionBase>[] {
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
  descriptor: PluginDescriptor;
  // Puts an alert on the screen above the tab, for what the plugin's edit
  // dialog reports.
  addAlert?: (alert: AlertType) => void;
}

// Every distribution that serves a repository, bound to it, to one of its
// publications or to one of its versions, with the URL the server reports for
// it, whether it serves content and the plugin's client command for it. The
// rows come from the index of the plugin's distributions that the other screens
// share, so the tab sends no request of its own per row.
export const DistributionsTab = ({
  repository,
  descriptor,
  addAlert = () => undefined,
}: Props) => {
  const { distribution, publication } = descriptor;
  if (!distribution) {
    throw new Error(
      'The descriptor declares no distribution, which the Distributions tab needs',
    );
  }
  const snippet = descriptor.repository.snippet;
  const serving = useRepositoryDistributions(
    distribution.entity,
    publication,
    repository.pulp_href,
  );
  const { hasPermission } = useAppContext();
  const edit = distribution.edit;
  // Offered to a user who holds the permission on every distribution; nothing
  // is drawn on a guess.
  const canEdit = edit !== undefined && hasPermission(edit.permission);
  const [editing, setEditing] = useState<DistributionBase | null>(null);
  const [params, setParams] = useState<TabParams>(DEFAULT_PARAMS);
  const [inputText, setInputText] = useState('');

  const rows = useMemo(
    () => shown(serving.distributions ?? [], params),
    [serving.distributions, params],
  );
  const start = (params.page - 1) * params.page_size;
  const pageRows = rows.slice(start, start + params.page_size);

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
      />
    );
  }

  const filterConfig = [
    { id: 'name__icontains', title: t`Name` },
    { id: 'base_path__icontains', title: t`Base path` },
  ];
  const filterSet = FILTER_PARAMS.some((key) => params[key] !== undefined);
  const headers = [
    { id: 'name', title: t`Name`, type: 'alpha' },
    { id: 'base_path', title: t`Base path`, type: 'alpha' },
    { id: 'url', title: t`URL`, type: 'none' },
    { id: 'pulp_created', title: t`Created`, type: 'numeric' },
    ...(snippet
      ? [{ id: 'snippet', title: i18n._(snippet.label), type: 'none' }]
      : []),
  ];
  const updateParams = (next: Partial<TabParams>) =>
    setParams({ ...DEFAULT_PARAMS, ...next } as TabParams);

  return (
    <>
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
          <Tbody>
            {pageRows.map(({ row, served }) => (
              <Tr key={row.pulp_href}>
                <Td>{row.name}</Td>
                <Td>{row.base_path}</Td>
                <Td>
                  <DistributionURL
                    distribution={{ url: row.base_url ?? null, served }}
                  />
                </Td>
                <Td>
                  <DateComponent date={row.pulp_created ?? ''} />
                </Td>
                {snippet ? (
                  <Td>
                    {row.base_url ? (
                      <ClipboardCopy isCode isReadOnly variant='inline-compact'>
                        {snippet.build({
                          name: repository.name,
                          url: row.base_url,
                        })}
                      </ClipboardCopy>
                    ) : (
                      t`None`
                    )}
                  </Td>
                ) : null}
                {edit && canEdit ? (
                  <ListItemActions
                    kebabItems={[
                      <DropdownItem key='edit' onClick={() => setEditing(row)}>
                        {i18n._(edit.label)}
                      </DropdownItem>,
                    ]}
                  />
                ) : null}
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
      {rows.length > 0 ? (
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={rows.length}
        />
      ) : null}
      {edit && editing
        ? edit.dialog({
            distribution: editing,
            onClose: () => setEditing(null),
            addAlert,
          })
        : null}
    </>
  );
};

// The Distributions tab as a plugin declares it among its tabs.
export const distributionsTab = <
  Row extends RepositoryBase,
>(): TabDef<Row> => ({
  id: 'distributions',
  label: msg`Distributions`,
  render: ({ repository, descriptor, addAlert }) => (
    <DistributionsTab
      repository={repository}
      descriptor={descriptor}
      addAlert={addAlert}
    />
  ),
});
