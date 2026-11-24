import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { DropdownItem, List, ListItem } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  type AlertType,
  DateComponent,
  EmptyStateNoData,
  ListErrorState,
  ListItemActions,
  LoadingSpinner,
  PulpPagination,
  SortTable,
  Spinner,
  Table,
} from 'src/components';
import { RowActionsColumn } from 'src/components/list-item-actions';
import type { PublicationRow } from 'src/entities/core/publication/client';
import { usePublicationsOfRepository } from 'src/entities/core/publication/queries';
import { versionNumberOf } from 'src/entities/href';
import {
  type DistributionBase,
  useDistributionIndex,
} from 'src/entities/plugin/distribution';
import {
  DEFAULT_PAGE_SIZE,
  type RepositoryBase,
} from 'src/entities/plugin/model';
import {
  type PublicationBase,
  useRepositoryPublications,
} from 'src/entities/plugin/publication';
import { useEntityList } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import type { PluginDescriptor, TabDef } from '../descriptor';
import { PAGE_SIZES } from '../list/list-params';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { DeletePublicationDialog } from '../publish/delete-publication-dialog';
import { publicationServedBy } from '../publish/publication-consequences';
import { usePublicationDeletePermits } from '../publish/use-publication-permits';
import { distributionPath, versionPath } from '../route-patterns';

// What the address of the list says: the page, its size and the order. The
// address is user input, so it is read into values the list offers and nothing
// else.
interface PublicationParams {
  page: number;
  page_size: number;
  sort: string;
}

const DEFAULT_SORT = '-pulp_created';
// The fields the server orders publications by.
const SORTABLE = ['pulp_created'];
const DIGITS = /^[1-9][0-9]*$/;

function paramsOfSearch(search: string): PublicationParams {
  const address = new URLSearchParams(search);
  const page = address.get('page');
  const size = address.get('page_size');
  const sort = address.get('sort');
  const pageSize = size !== null && DIGITS.test(size) ? Number(size) : NaN;
  const field = sort?.replace(/^-/, '') ?? '';

  return {
    page:
      page !== null && DIGITS.test(page) && Number.isSafeInteger(Number(page))
        ? Number(page)
        : 1,
    page_size: PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    sort: sort !== null && SORTABLE.includes(field) ? sort : DEFAULT_SORT,
  };
}

// The query string of the list, leaving out what is the default.
function searchOfParams({ page, page_size, sort }: PublicationParams): string {
  const parts = [
    ...(page !== 1 ? [`page=${page}`] : []),
    ...(page_size !== DEFAULT_PAGE_SIZE ? [`page_size=${page_size}`] : []),
    ...(sort !== DEFAULT_SORT ? [`sort=${encodeURIComponent(sort)}`] : []),
  ];

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  addAlert: (alert: AlertType) => void;
}

// A repository's publications, newest first, a server page at a time: the
// version each was made from, when, the options the plugin declares and the
// distributions that really serve it. A distribution bound to a repository is
// listed under the newest publication of the highest published version, one
// bound to a version under the newest publication of that version, and one
// bound to a publication under that publication. Deleting a publication is
// offered on a row to a user who may delete it, after a confirmation that says
// what the delete does to the distributions that serve it.
export const PublicationsTab = ({
  plugin,
  descriptor,
  repository,
  addAlert,
}: Props) => {
  const { publication: kind, distribution } = descriptor;
  if (!kind || !distribution) {
    throw new Error(
      'The descriptor declares no publication, which the Publications tab needs',
    );
  }
  const { hasPermission } = useAppContext();
  const viewPermission = PLUGIN_MANIFESTS.find(
    (manifest) => manifest.plugin === plugin,
  )?.permissions.publication?.view;
  const mayRead = viewPermission !== undefined && hasPermission(viewPermission);

  const { search } = useLocation();
  const navigate = useNavigate();
  const params = paramsOfSearch(search);
  const query = usePublicationsOfRepository(repository.pulp_href, params, {
    enabled: mayRead,
  });
  const rows = query.data?.results;

  // The options of the rows, which only the plugin's own read has.
  const columns = kind.columns ?? [];
  const optionRows = useEntityList(
    kind.entity,
    {
      pulp_href__in: (rows ?? []).map(({ pulp_href }) => pulp_href),
      page_size: Math.max(rows?.length ?? 0, 1),
    },
    { enabled: columns.length > 0 && rows !== undefined && rows.length > 0 },
  );
  const optionsByHref = useMemo(
    () =>
      new Map<string, PublicationBase>(
        (optionRows.data?.results ?? []).map((row) => [row.pulp_href, row]),
      ),
    [optionRows.data],
  );

  // What each distribution of the repository serves.
  const index = useDistributionIndex(distribution.entity, kind.entity);
  const all = useRepositoryPublications(kind.entity, repository.pulp_href, {
    enabled: mayRead,
  });
  const { distributionsOfRepository } = index;
  const servedBy = useMemo(() => {
    const own = distributionsOfRepository(repository.pulp_href);
    if (!own || !all.data) {
      return undefined;
    }
    const byPublication = new Map<string, DistributionBase[]>();
    for (const row of own) {
      const served = publicationServedBy(row, all.data);
      if (served) {
        byPublication.set(served.pulp_href, [
          ...(byPublication.get(served.pulp_href) ?? []),
          row,
        ]);
      }
    }
    return byPublication;
  }, [distributionsOfRepository, repository.pulp_href, all.data]);

  const mayDelete = usePublicationDeletePermits(plugin, {
    rowsShown: (rows?.length ?? 0) > 0,
  });
  const canDelete = kind.entity.remove !== undefined;
  const hasActions = canDelete && (rows ?? []).some((row) => mayDelete(row));
  const [deleting, setDeleting] = useState<PublicationRow | null>(null);

  const updateParams = (next: PublicationParams) =>
    navigate({ search: searchOfParams(next) });

  // A delete can leave the page on screen past the last one: go to the last.
  const count = query.data?.count ?? 0;
  const pastEnd = rows?.length === 0 && count > 0 && params.page > 1;
  const lastPage = Math.max(1, Math.ceil(count / params.page_size));
  const { page_size, sort } = params;
  useEffect(() => {
    if (pastEnd) {
      navigate({ search: searchOfParams({ page: lastPage, page_size, sort }) });
    }
  }, [pastEnd, lastPage, page_size, sort, navigate]);

  if (!mayRead) {
    return (
      <EmptyStateNoData
        title={t`Publications cannot be listed`}
        description={t`You may not read the publications of this plugin, so they cannot be listed here.`}
      />
    );
  }
  if (!query.data) {
    // A session that ended keeps the spinner: the sign-in dialog explains it
    // and the read runs again afterwards.
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <ListErrorState
        title={t`Publications could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    ) : (
      <LoadingSpinner />
    );
  }
  if (query.data.count === 0) {
    return (
      <EmptyStateNoData
        title={t`No publications yet`}
        description={t`A publication is made when the repository is published. A distribution serves a repository's content through its publications.`}
      />
    );
  }

  const headers = [
    { id: 'version', title: t`Version`, type: 'none' },
    { id: 'pulp_created', title: t`Created`, type: 'numeric' },
    ...columns.map(({ id, label }) => ({
      id,
      title: i18n._(label),
      type: 'none',
    })),
    { id: 'distributions', title: t`Distributions`, type: 'none' },
    ...(hasActions ? [{ id: 'actions', title: '', type: 'none' }] : []),
  ];

  return (
    <>
      <div className='pulp-toolbar' data-cy='PublicationsTab'>
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={query.data.count}
          perPageOptions={PAGE_SIZES}
          isTop
        />
      </div>
      <Table aria-label={t`Publications`}>
        <SortTable
          options={{ headers }}
          params={params}
          updateParams={updateParams}
        />
        <RowActionsColumn.Provider value={hasActions}>
          <Tbody>
            {(rows ?? []).map((row) => {
              const number = versionNumberOf(row.repository_version);
              const serving = servedBy?.get(row.pulp_href) ?? [];
              // the plugin's own row when it has one, else the shared one
              const detail = optionsByHref.get(row.pulp_href) ?? row;

              return (
                <Tr key={row.pulp_href}>
                  <Td>
                    {number === null ? (
                      t`Unknown`
                    ) : (
                      <Link to={versionPath(plugin, repository.name, number)}>
                        {number}
                      </Link>
                    )}
                  </Td>
                  <Td>
                    <DateComponent date={row.pulp_created ?? ''} />
                  </Td>
                  {columns.map(({ id, render }) => (
                    <Td key={id}>
                      {optionRows.data || columns.length === 0 ? (
                        render(detail)
                      ) : optionRows.isError ? (
                        t`Not available`
                      ) : (
                        <Spinner size='sm' aria-label={t`Loading`} />
                      )}
                    </Td>
                  ))}
                  <Td>
                    {servedBy === undefined ? (
                      index.status === 'error' || all.status === 'error' ? (
                        t`Not available`
                      ) : (
                        <Spinner size='sm' aria-label={t`Loading`} />
                      )
                    ) : serving.length === 0 ? (
                      t`None`
                    ) : (
                      <List isPlain>
                        {serving.map(({ pulp_href, name }) => (
                          <ListItem key={pulp_href}>
                            <Link to={distributionPath(plugin, name)}>
                              {name}
                            </Link>
                          </ListItem>
                        ))}
                      </List>
                    )}
                  </Td>
                  <ListItemActions
                    kebabItems={
                      canDelete && mayDelete(row)
                        ? [
                            <DropdownItem
                              key='delete'
                              onClick={() => setDeleting(row)}
                            >
                              {t`Delete`}
                            </DropdownItem>,
                          ]
                        : []
                    }
                  />
                </Tr>
              );
            })}
          </Tbody>
        </RowActionsColumn.Provider>
      </Table>
      <PulpPagination
        params={params}
        updateParams={updateParams}
        count={query.data.count}
        perPageOptions={PAGE_SIZES}
      />
      {deleting ? (
        <DeletePublicationDialog
          plugin={plugin}
          descriptor={descriptor}
          repository={repository}
          publication={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(done) => {
            setDeleting(null);
            const number = versionNumberOf(done.repository_version);
            addAlert({
              variant: 'success',
              title:
                number === null
                  ? t`Publication deleted`
                  : t`Publication of version ${number} deleted`,
            });
          }}
        />
      ) : null}
    </>
  );
};

// The Publications tab as a plugin declares it among its tabs, for a plugin
// whose repositories are served through publications.
export const publicationsTab = <Row extends RepositoryBase>(): TabDef<Row> => ({
  id: 'publications',
  label: msg`Publications`,
  render: ({ repository, plugin, descriptor, addAlert }) => (
    <PublicationsTab
      plugin={plugin}
      descriptor={descriptor}
      repository={repository}
      addAlert={addAlert}
    />
  ),
});
