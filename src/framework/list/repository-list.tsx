import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  Alert,
  AlertList,
  type AlertType,
  BaseHeader,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  ListErrorState,
  ListItemActions,
  LoadingSpinner,
  Main,
  PulpPagination,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { RowActionsColumn } from 'src/components/list-item-actions';
import { useVersionSummaries } from 'src/entities/core/repository-version/queries';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
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
  requestErrorReason,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { ColumnDef, FilterDef, PluginDescriptor } from '../descriptor';
import { labelKeysOf } from '../labels/label-select';
import {
  type FrameworkPlugin,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';
import { newRepositoryPath } from '../route-patterns';
import {
  BaseUrlCell,
  type ColumnState,
  ContentCountCell,
  LastTaskCell,
  VersionCell,
} from './derived-columns';
import { FilterChips, ListFilters } from './filters';
import {
  type ListParams,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from './list-params';
import {
  REPOSITORY_ROW_ACTIONS,
  type RepositoryPermission,
  type RowAction,
  type RowActionContext,
  actionsFor,
} from './row-actions';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  // The actions of a row's menu. Every list has the ones of
  // REPOSITORY_ROW_ACTIONS; a screen that adds actions passes its own list.
  actions?: RowAction<RepositoryBase>[];
}

const NO_COLUMNS: ColumnDef<RepositoryBase>[] = [];
const NO_FILTERS: FilterDef[] = [];

// The page a refused filter leaves on screen when there is no earlier one.
const NO_PAGE = { count: 0, next: null, previous: null, results: [] };

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
export const RepositoryList = ({
  plugin,
  descriptor,
  actions = REPOSITORY_ROW_ACTIONS,
}: Props) => {
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
      actions={actions}
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
  plugin,
  descriptor,
  actions = REPOSITORY_ROW_ACTIONS,
  distribution,
  publication,
}: ScreenProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    alerts: queuedAlerts,
    setAlerts: setQueuedAlerts,
    hasPermission,
    permissionsError,
    permissionsFailed,
    permissionsReady,
    retryPermissions,
  } = useAppContext();
  const {
    entity,
    columns = NO_COLUMNS,
    filters = NO_FILTERS,
  } = descriptor.repository;
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const names = manifest.permissions.repository;

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

  // The server refuses a label expression it cannot read with a 400. That is
  // an answer about the expression and not a failure of the list: the rows of
  // the last result stay and the reason is shown at the filter.
  const refusedFilter =
    query.isError &&
    requestErrorStatus(query.error) === 400 &&
    params.pulp_label_select !== undefined;
  const lastShown = useRef<typeof query.data>(undefined);
  if (query.data && !query.isPlaceholderData) {
    lastShown.current = query.data;
  }
  const data =
    query.data ??
    (refusedFilter
      ? (lastShown.current ?? (NO_PAGE as unknown as typeof query.data))
      : undefined);
  const rows = useMemo(() => data?.results ?? [], [data]);
  const labelRefusal = refusedFilter
    ? (requestErrorReason(query.error) ?? t`The label filter was not accepted.`)
    : null;
  const labelKeys = useMemo(
    () => labelKeysOf((data ?? lastShown.current)?.results ?? []),
    [data],
  );

  // The first read fills the whole screen with its state. Once something has
  // been shown, a read for another filter shows its state in place of the
  // table only, so the filters stay where they are being used.
  const everShown = useRef(false);
  if (data) {
    everShown.current = true;
  }

  const distributions = useDistributionIndex(distribution, publication);
  const tasks = useTaskIndex();
  const versions = useVersionSummaries(
    rows.map((row) => row.latest_version_href),
  );

  // Whether the user may take an action on a row: the permission is held on
  // every repository, or, for a plugin whose roles can be granted on a single
  // repository, held on this one according to the roles the user has on single
  // objects. Anything not known yet is no.
  const needsObjectRoles =
    manifest.permissions.objectRoles &&
    permissionsReady &&
    actions.some(({ permission }) => !hasPermission(names[permission]));
  const rowsShown = rows.length > 0 && !query.isPlaceholderData;
  // The roles on single objects are read behind the rows, and only for a user
  // who lacks a permission on every repository.
  const objectRoles = useObjectPermissions({
    enabled: rowsShown && needsObjectRoles,
  });
  const permits = (permission: RepositoryPermission, row: RepositoryBase) =>
    hasPermission(names[permission]) ||
    (needsObjectRoles && objectRoles.can(row.pulp_href, names[permission]));
  const actionContext = useMemo<RowActionContext>(
    () => ({ plugin, navigate }),
    [plugin, navigate],
  );

  // A failed read of what the user may do says so once, with the one button
  // that reads it again. Nothing the user may not be confirmed to do is drawn
  // meanwhile, and the failure is never taken for a refusal.
  const permissionsNotice =
    permissionsFailed || (needsObjectRoles && objectRoles.state === 'error') ? (
      <Alert
        isInline
        variant='warning'
        title={t`Your permissions could not be read`}
        actionLinks={
          <AlertActionLink
            onClick={permissionsFailed ? retryPermissions : objectRoles.retry}
          >{t`Retry`}</AlertActionLink>
        }
        style={{ marginBottom: '16px' }}
      >
        {permissionsFailed ? requestErrorDescription(permissionsError) : null}
      </Alert>
    ) : null;

  const addButton = hasPermission(names.add) ? (
    <Button
      variant='primary'
      onClick={() => navigate(newRepositoryPath(plugin))}
    >
      {t`Add repository`}
    </Button>
  ) : undefined;

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

  const failed = query.isError && !sessionEnded && !data && !query.isFetching;
  const loading = !data && !failed;
  const noData = !!data && rows.length === 0 && !filterIsSet;

  if (loading && !everShown.current) {
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
  if (failed && !everShown.current) {
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
        {permissionsNotice ? <Main>{permissionsNotice}</Main> : null}
        <EmptyStateNoData
          title={t`No repositories yet`}
          description={t`Repositories will appear once created.`}
          button={addButton}
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

  // The actions each row offers, by id, so a row is rebuilt only when its own
  // actions change. A list in which no row offers one has no actions column.
  const rowActionIds = rows.map((row) =>
    actionsFor(actions, row, permits)
      .map(({ id }) => id)
      .join(','),
  );
  const anyRowAction = rowActionIds.some((ids) => ids !== '');

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
    ...(anyRowAction ? [{ id: 'actions', title: '', type: 'none' }] : []),
  ];

  const count = data?.count ?? 0;
  const hasRows = !!data && rows.length > 0;

  // What the table's place shows: the rows, the way out of a filter that
  // matches nothing, or the state of a read that is still on its way or failed.
  let content;
  if (loading) {
    content = <LoadingSpinner />;
  } else if (failed) {
    content = (
      <ListErrorState
        title={t`Repositories could not be displayed.`}
        message={requestErrorDescription(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyStateFilter
        clearAllFilters={() =>
          updateParams({
            page: 1,
            page_size: params.page_size,
            sort: params.sort,
          })
        }
      />
    );
  } else {
    content = (
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
        <RowActionsColumn.Provider value={anyRowAction}>
          <Tbody>
            {rows.map((row, position) => (
              <RepositoryRow
                key={row.pulp_href}
                row={row}
                columns={columns}
                actions={actions}
                actionIds={rowActionIds[position] as string}
                actionContext={actionContext}
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
        </RowActionsColumn.Provider>
      </Table>
    );
  }

  return (
    <>
      {alertList}
      {header}
      <Main>
        <section className='pulp-section'>
          <div className='pulp-toolbar'>
            <Toolbar>
              <ToolbarContent>
                <ListFilters
                  filters={filters}
                  params={params}
                  updateParams={updateParams}
                  labelKeys={labelKeys}
                  labelRefusal={labelRefusal}
                />
                {addButton ? (
                  <ToolbarGroup>
                    <ToolbarItem>{addButton}</ToolbarItem>
                  </ToolbarGroup>
                ) : null}
              </ToolbarContent>
            </Toolbar>
            <PulpPagination
              params={params}
              updateParams={updateParams}
              count={count}
              perPageOptions={PAGE_SIZES}
              isTop
            />
          </div>
          <div>
            <FilterChips
              filters={filters}
              params={params}
              updateParams={updateParams}
            />
          </div>
          {permissionsNotice}
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
          {content}
          {hasRows ? (
            <PulpPagination
              params={params}
              updateParams={updateParams}
              count={count}
              perPageOptions={PAGE_SIZES}
            />
          ) : null}
        </section>
      </Main>
    </>
  );
};

interface RowProps {
  row: RepositoryBase;
  columns: ColumnDef<RepositoryBase>[];
  actions: RowAction<RepositoryBase>[];
  // The ids of the actions the row offers, joined by commas.
  actionIds: string;
  actionContext: RowActionContext;
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
  actions,
  actionIds,
  actionContext,
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
      <ListItemActions
        kebabItems={actions
          .filter(({ id }) => actionIds.split(',').includes(id))
          .map((action) => action.item(row, actionContext))}
      />
    </Tr>
  );
});
