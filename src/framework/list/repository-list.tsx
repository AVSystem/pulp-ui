import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { AlertActionLink } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  Alert,
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  ListErrorState,
  LoadingSpinner,
  Main,
  PulpPagination,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { useVersionSummaries } from 'src/entities/core/repository-version/queries';
import type { Task } from 'src/entities/core/task/model';
import { lastTaskOf, useTaskIndex } from 'src/entities/core/task/task-index';
import { useDistributionIndex } from 'src/entities/plugin/distribution';
import type {
  RepositoryBase,
  RepositoryListParams,
} from 'src/entities/plugin/model';
import { useEntityList } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { ColumnDef, PluginDescriptor } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import {
  BaseUrlCell,
  type ColumnState,
  ContentCountCell,
  LastTaskCell,
  VersionCell,
} from './derived-columns';
import {
  type ListParams,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from './list-params';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// What every list reads of a repository whatever its columns are: the address
// the derived columns match on, the PRN the last task is found by and the
// latest version the content count is read for.
const BASE_FIELDS = ['pulp_href', 'name', 'prn', 'latest_version_href'];

// The columns that fill from reads shared between the rows.
const DERIVED_HEADERS = [
  { id: 'base-url', title: () => t`Base URL` },
  { id: 'latest-version', title: () => t`Latest version` },
  { id: 'content', title: () => t`Content` },
  { id: 'last-task', title: () => t`Last task` },
] as const;

// What a derived column's read has come to, in the terms of a cell.
function stateOf(
  status: 'pending' | 'loading' | 'error' | 'success' | 'ready' | 'unsupported',
): ColumnState {
  switch (status) {
    case 'pending':
    case 'loading':
      return 'loading';
    case 'success':
    case 'ready':
      return 'ready';
    default:
      return status;
  }
}

// The generic list of a plugin's repositories. The address holds the page, its
// size, the order and the filters, and the screen shows exactly what it says.
// The rows come from one read of the page. Where each repository is served, its
// content count and its last task come from reads the whole list shares (the
// distributions, the latest versions in groups, the task index), so the number
// of requests does not grow with the rows. A column whose read fails says so
// with a Retry and leaves the rows and the other columns alone.
export const RepositoryList = ({ plugin, descriptor }: Props) => {
  const { distribution, publication } = descriptor;

  if (!distribution) {
    throw new Error(
      `The ${plugin} descriptor declares no distribution, which a list of its repositories needs`,
    );
  }

  return (
    <RepositoryListScreen
      plugin={plugin}
      descriptor={descriptor}
      distribution={distribution.entity}
      publication={publication?.entity}
    />
  );
};

interface ScreenProps extends Props {
  distribution: NonNullable<PluginDescriptor['distribution']>['entity'];
  publication:
    NonNullable<PluginDescriptor['publication']>['entity'] | undefined;
}

const RepositoryListScreen = ({
  descriptor,
  distribution,
  publication,
}: ScreenProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { alerts: queuedAlerts, setAlerts: setQueuedAlerts } = useAppContext();
  const { entity, columns = [], filters = [] } = descriptor.repository;

  const options = useMemo(
    () => ({
      sortable: columns.flatMap(({ sortField }) =>
        sortField ? [sortField] : [],
      ),
      filters: filters.map(({ param }) => param),
    }),
    [columns, filters],
  );
  const params = useMemo(
    () => paramsOfAddress(location.search, options),
    [location.search, options],
  );
  const filterIsSet = options.filters.some(
    (param) => params[param] !== undefined,
  );

  // The fields the server is asked for: what every list needs and what the
  // columns of the descriptor read.
  const fields = useMemo(
    () =>
      Array.from(
        new Set([
          ...BASE_FIELDS,
          ...columns.flatMap((column) => column.fields ?? []),
        ]),
      ),
    [columns],
  );
  const request = useMemo(() => {
    const { page, page_size, sort, ...filterValues } = params;
    return {
      page,
      page_size,
      sort,
      fields,
      ...filterValues,
    } as RepositoryListParams;
  }, [params, fields]);

  const query = useEntityList(entity, request);
  const rows = useMemo(() => query.data?.results ?? [], [query.data]);

  const distributions = useDistributionIndex(distribution, publication);
  const tasks = useTaskIndex();
  const versions = useVersionSummaries(
    rows.map((row) => row.latest_version_href),
  );

  // What other screens queued for this one is shown once, then forgotten.
  const [alerts, setAlerts] = useState<AlertType[]>(() => queuedAlerts ?? []);
  useEffect(() => {
    setQueuedAlerts([]);
    // only at the first showing of the screen
  }, []);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A failed read of rows already on screen keeps the rows and says so once.
  const alertedFailure = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded && status !== 403;
  useEffect(() => {
    if (rereadFailed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: t`Repositories could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  const updateParams = (next: object) =>
    navigate({ search: searchOf(next as ListParams) });

  const header = <BaseHeader title={t`Repositories`} />;
  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // A refused read is not a failure to retry: the user is told they may not
  // view the list, with Pulp's own reason.
  if (status === 403) {
    return (
      <>
        {alertList}
        {header}
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  const failed =
    query.isError && !sessionEnded && !query.data && !query.isFetching;
  const loading = !query.data && !failed;
  const noData = !!query.data && rows.length === 0 && !filterIsSet;

  if (loading) {
    return (
      <>
        {alertList}
        {header}
        <Main>
          <LoadingSpinner />
        </Main>
      </>
    );
  }
  if (failed) {
    return (
      <>
        {alertList}
        {header}
        <Main>
          <ListErrorState
            title={t`Repositories could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }
  if (noData) {
    return (
      <>
        {alertList}
        {header}
        <EmptyStateNoData
          title={t`No repositories yet`}
          description={t`Repositories will appear once created.`}
        />
      </>
    );
  }

  const baseUrlState = stateOf(distributions.status);
  const contentState = stateOf(versions.state);
  const taskState = stateOf(tasks.state);
  const settled = [baseUrlState, contentState, taskState].every(
    (state) => state !== 'loading',
  );

  // A column that failed to read is named once, above the table, with the one
  // button that reads it again. The cells say it too, briefly.
  const failures = [
    baseUrlState === 'error' && !isSessionEnd(distributions.error)
      ? {
          id: 'base-url',
          title: t`Base URLs could not be read.`,
          retry: distributions.retry,
          description: requestErrorDescription(distributions.error),
        }
      : null,
    contentState === 'error'
      ? {
          id: 'content',
          title: t`Content counts could not be read.`,
          retry: versions.retry,
          description: undefined,
        }
      : null,
    taskState === 'error'
      ? {
          id: 'last-task',
          title: t`Last tasks could not be read.`,
          retry: tasks.retry,
          description: undefined,
        }
      : null,
  ].flatMap((failure) => (failure ? [failure] : []));

  const headers = [
    ...columns.map((column: ColumnDef<RepositoryBase>) => ({
      id: column.sortField ?? column.id,
      title: i18n._(column.label),
      type: column.sortField ? (column.sortKind ?? 'alpha') : 'none',
    })),
    ...DERIVED_HEADERS.map(({ id, title }) => ({
      id,
      title: title(),
      type: 'none',
    })),
  ];

  return (
    <>
      {alertList}
      {header}
      <Main>
        <section className='pulp-section'>
          <div className='pulp-toolbar'>
            <PulpPagination
              params={params}
              updateParams={updateParams}
              count={query.data?.count ?? 0}
              perPageOptions={PAGE_SIZES}
              isTop
            />
          </div>
          <div>
            <AppliedFilters
              updateParams={updateParams}
              params={params}
              ignoredParams={['page_size', 'page', 'sort']}
              niceNames={Object.fromEntries(
                filters.map(({ param, label }) => [param, i18n._(label)]),
              )}
            />
          </div>
          {failures.map(({ id, title, retry, description }) => (
            <Alert
              key={id}
              isInline
              variant='warning'
              title={title}
              actionLinks={
                <AlertActionLink onClick={retry}>{t`Retry`}</AlertActionLink>
              }
              style={{ marginBottom: '16px' }}
            >
              {description}
            </Alert>
          ))}
          {rows.length === 0 ? (
            <EmptyStateFilter
              clearAllFilters={() =>
                updateParams({
                  page: 1,
                  page_size: params.page_size,
                  sort: params.sort,
                })
              }
            />
          ) : (
            <Table
              aria-label={t`Repositories`}
              data-rows-loaded={!query.isPlaceholderData}
              data-columns-loaded={settled}
            >
              <SortTable
                options={{ headers }}
                params={params}
                updateParams={updateParams}
              />
              <Tbody>
                {rows.map((row) => (
                  <RepositoryRow
                    key={row.pulp_href}
                    row={row}
                    columns={columns}
                    baseUrlState={baseUrlState}
                    baseUrls={distributions.baseUrlsByRepository?.get(
                      row.pulp_href,
                    )}
                    contentState={contentState}
                    contentCount={
                      row.latest_version_href
                        ? versions.counts.get(row.latest_version_href)
                        : undefined
                    }
                    taskState={taskState}
                    lastTask={lastTaskOf(tasks, row.prn)}
                  />
                ))}
              </Tbody>
            </Table>
          )}
          <PulpPagination
            params={params}
            updateParams={updateParams}
            count={query.data?.count ?? 0}
            perPageOptions={PAGE_SIZES}
          />
        </section>
      </Main>
    </>
  );
};

interface RowProps {
  row: RepositoryBase;
  columns: ColumnDef<RepositoryBase>[];
  baseUrlState: ColumnState;
  baseUrls: readonly string[] | undefined;
  contentState: ColumnState;
  contentCount: number | null | undefined;
  taskState: ColumnState;
  lastTask: Task | null;
}

// One row. It is rebuilt only when what it shows changes, so a shared read that
// settles redraws the rows it has something new for and not every row of a page
// of 500.
const RepositoryRow = memo(function RepositoryRow({
  row,
  columns,
  baseUrlState,
  baseUrls,
  contentState,
  contentCount,
  taskState,
  lastTask,
}: RowProps) {
  return (
    <Tr data-cy={`RepositoryList-row-${row.name}`}>
      {columns.map((column) => (
        <Td key={column.id}>{column.render(row)}</Td>
      ))}
      <Td>
        <BaseUrlCell state={baseUrlState} urls={baseUrls} />
      </Td>
      <Td>
        <VersionCell href={row.latest_version_href} />
      </Td>
      <Td>
        <ContentCountCell
          state={contentState}
          count={contentCount}
          hasVersion={!!row.latest_version_href}
        />
      </Td>
      <Td>
        <LastTaskCell state={taskState} task={lastTask} />
      </Td>
    </Tr>
  );
});
