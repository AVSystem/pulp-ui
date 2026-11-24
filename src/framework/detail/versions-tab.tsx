import { msg, t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import {
  type AlertType,
  DateComponent,
  EmptyStateNoData,
  ListErrorState,
  ListItemActions,
  LoadingSpinner,
  PulpPagination,
  SortTable,
  Table,
} from 'src/components';
import { RowActionsColumn } from 'src/components/list-item-actions';
import type {
  RepositoryBase,
  RepositoryVersion,
} from 'src/entities/plugin/model';
import { useRepositoryVersions } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import {
  type PluginDescriptor,
  type TabDef,
  repositoryOf,
} from '../descriptor';
import { PAGE_SIZES } from '../list/list-params';
import type { FrameworkPlugin } from '../manifest';
import { PublishDialog } from '../publish/publish-dialog';
import { useMayPublish } from '../publish/use-may-publish';
import { versionPath } from '../route-patterns';
import { RevertVersionDialog } from './revert-version';
import { useRepositoryPermission } from './use-repository-permission';
import { VersionDetail } from './version-detail';

// What the address of the list says: the page, its size and the order. The
// address is user input, so it is read into values the list offers and nothing
// else.
interface VersionParams {
  page: number;
  page_size: number;
  sort: string;
}

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_SORT = '-pulp_created';
// The fields the server orders versions by.
const SORTABLE = ['number', 'pulp_created'];
const DIGITS = /^[1-9][0-9]*$/;

function paramsOfSearch(search: string): VersionParams {
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
function searchOfParams({ page, page_size, sort }: VersionParams): string {
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
  // The number the address names, null on the list.
  version: number | null;
  addAlert: (alert: AlertType) => void;
}

// A repository's versions: the list, newest first, and one version when the
// address names one. Reverting the repository to a version is offered on a row
// to a user who may change the repository's content, and publishing that
// version to a user who may publish.
export const VersionsTab = ({
  plugin,
  descriptor,
  repository,
  version,
  addAlert,
}: Props) =>
  version === null ? (
    <VersionList
      plugin={plugin}
      descriptor={descriptor}
      repository={repository}
      addAlert={addAlert}
    />
  ) : (
    <VersionDetail
      plugin={plugin}
      descriptor={descriptor}
      repository={repository}
      number={version}
    />
  );

const VersionList = ({
  plugin,
  descriptor,
  repository,
  addAlert,
}: Omit<Props, 'version'>) => {
  const { entity } = repositoryOf(descriptor);
  const { search } = useLocation();
  const navigate = useNavigate();
  const params = paramsOfSearch(search);
  const query = useRepositoryVersions(entity, repository.pulp_href, params);
  const [revertTo, setRevertTo] = useState<RepositoryVersion | null>(null);
  const [publishing, setPublishing] = useState<RepositoryVersion | null>(null);
  const mayRevert =
    useRepositoryPermission(plugin, repository, 'modify') && !!entity.modify;
  const mayPublish = useMayPublish(plugin, descriptor);
  const hasActions = mayRevert || mayPublish;

  const updateParams = (next: VersionParams) =>
    navigate({ search: searchOfParams(next) });

  const data = query.data;
  if (!data) {
    // A session that ended keeps the spinner: the sign-in dialog explains it
    // and the read runs again afterwards.
    return query.isError && !isSessionEnd(query.error) && !query.isFetching ? (
      <ListErrorState
        title={t`Repository versions could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    ) : (
      <LoadingSpinner />
    );
  }
  if (data.count === 0) {
    return (
      <EmptyStateNoData
        title={t`No repository versions yet`}
        description={t`Repository versions will appear once the repository is modified.`}
      />
    );
  }

  const headers = [
    { id: 'number', title: t`Version number`, type: 'numeric' },
    { id: 'pulp_created', title: t`Created date`, type: 'numeric' },
    ...(hasActions ? [{ id: 'actions', title: '', type: 'none' }] : []),
  ];

  return (
    <>
      <div className='pulp-toolbar' data-cy='VersionsTab'>
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={data.count}
          perPageOptions={PAGE_SIZES}
          isTop
        />
      </div>
      <Table aria-label={t`Repository versions`}>
        <SortTable
          options={{ headers }}
          params={params}
          updateParams={updateParams}
        />
        <RowActionsColumn.Provider value={hasActions}>
          <Tbody>
            {data.results.map((row) => {
              const isLatest = row.pulp_href === repository.latest_version_href;

              return (
                <Tr key={row.pulp_href}>
                  <Td>
                    <Link to={versionPath(plugin, repository.name, row.number)}>
                      {row.number}
                    </Link>
                    {isLatest ? ` ${t`(latest)`}` : null}
                  </Td>
                  <Td>
                    <DateComponent date={row.pulp_created ?? ''} />
                  </Td>
                  <ListItemActions
                    kebabItems={[
                      ...(mayPublish
                        ? [
                            <DropdownItem
                              key='publish'
                              onClick={() => setPublishing(row)}
                            >
                              {t`Publish this version`}
                            </DropdownItem>,
                          ]
                        : []),
                      ...(mayRevert
                        ? [
                            isLatest ? (
                              <DropdownItem
                                key='revert'
                                isAriaDisabled
                                description={t`Already the current version`}
                              >
                                {t`Revert to this version`}
                              </DropdownItem>
                            ) : (
                              <DropdownItem
                                key='revert'
                                onClick={() => setRevertTo(row)}
                              >
                                {t`Revert to this version`}
                              </DropdownItem>
                            ),
                          ]
                        : []),
                    ]}
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
        count={data.count}
        perPageOptions={PAGE_SIZES}
      />
      {publishing ? (
        <PublishDialog
          descriptor={descriptor}
          repository={repository}
          version={publishing}
          onClose={() => setPublishing(null)}
        />
      ) : null}
      {revertTo ? (
        <RevertVersionDialog
          repository={repository}
          version={revertTo}
          entity={entity}
          addAlert={addAlert}
          onClose={() => setRevertTo(null)}
        />
      ) : null}
    </>
  );
};

// The Versions tab as a plugin declares it among its tabs.
export const versionsTab = <Row extends RepositoryBase>(): TabDef<Row> => ({
  id: 'versions',
  label: msg`Versions`,
  render: ({ repository, version, plugin, descriptor, addAlert }) => (
    <VersionsTab
      plugin={plugin}
      descriptor={descriptor}
      repository={repository}
      version={version}
      addAlert={addAlert}
    />
  ),
});
