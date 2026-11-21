import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  Alert,
  AlertList,
  BaseHeader,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  ListErrorState,
  ListItemActions,
  LoadingSpinner,
  Main,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { RowActionsColumn } from 'src/components/list-item-actions';
import { useVersionSummaries } from 'src/entities/core/repository-version/queries';
import type { Task } from 'src/entities/core/task/model';
import { lastTaskOf, useTaskIndex } from 'src/entities/core/task/task-index';
import { useDistributionIndex } from 'src/entities/plugin/distribution';
import type {
  RepositoryBase,
  RepositoryListParams,
} from 'src/entities/plugin/model';
import { useRepositoryIndex } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import {
  BULK_REPOSITORY_PERMISSIONS,
  RepositoryBulk,
  repositoryBulkActions,
} from '../bulk/repository-bulk';
import { SelectCell } from '../bulk/select-cells';
import { usePageSelection } from '../bulk/selection';
import { DeleteRepositoryDialog } from '../delete/delete-repository-dialog';
import type { ColumnDef, FilterDef, PluginDescriptor } from '../descriptor';
import { labelKeysOf } from '../labels/label-select';
import {
  type FrameworkPlugin,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';
import { newRepositoryPath } from '../route-patterns';
import { SyncDialog } from '../sync/sync-dialog';
import { useQueuedAlerts } from '../use-queued-alerts';
import {
  BaseUrlCell,
  type ColumnState,
  ContentCountCell,
  LastTaskCell,
  VersionCell,
} from './derived-columns';
import { FilterChips, ListFilters } from './filters';
import {
  ColumnFailures,
  ListLayout,
  useLastPageWhenPastEnd,
  useListAddress,
  useRereadAlert,
  useRowPermits,
  useShownRows,
} from './list-frame';
import { searchOf } from './list-params';
import { type BasePathSelection, useRepositoryRows } from './repository-rows';
import {
  REPOSITORY_ROW_ACTIONS,
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

// How many repositories a base path may select before the list says so: they
// are read and paged here, so a very wide match is worth narrowing.
const LARGE_MATCH = 500;

// What every list reads of a repository whatever its columns are: the address
// the derived columns match on, the PRN the last task is found by, the latest
// version the content count is read for, and the remote and the labels the row
// and bulk actions decide on.
const BASE_FIELDS = [
  'pulp_href',
  'name',
  'prn',
  'latest_version_href',
  'remote',
  'pulp_labels',
];

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
  const navigate = useNavigate();
  const { hasPermission } = useAppContext();
  const {
    entity,
    columns = NO_COLUMNS,
    filters = NO_FILTERS,
  } = descriptor.repository;
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const names = manifest.permissions.repository;

  const { params, filterIsSet, updateParams } = useListAddress(
    columns,
    filters,
  );

  // The fields the server is asked for: what every list needs and what the
  // columns of the descriptor read.
  const fields = useMemo(
    () =>
      Array.from(
        new Set([
          ...BASE_FIELDS,
          ...(descriptor.repository.sync?.fields ?? []),
          ...columns.flatMap((column) => column.fields ?? []),
        ]),
      ),
    [columns, descriptor.repository.sync],
  );
  // The base path is not a field of a repository: it selects repositories
  // through the distributions that serve them, so it is not part of the request.
  const basePathText =
    typeof params.base_path === 'string' ? params.base_path : undefined;
  const request = useMemo(() => {
    const { page, page_size, sort } = params;
    const filterValues = Object.fromEntries(
      Object.entries(params).filter(
        ([key]) => !['page', 'page_size', 'sort', 'base_path'].includes(key),
      ),
    );
    return {
      page,
      page_size,
      sort,
      fields,
      ...filterValues,
    } as RepositoryListParams;
  }, [params, fields]);

  const distributions = useDistributionIndex(distribution, publication);
  const basePath = useMemo<BasePathSelection>(
    () => ({
      text: basePathText,
      matches:
        basePathText === undefined
          ? null
          : distributions.repositoriesMatchingBasePath(basePathText),
      status: distributions.status,
      error: distributions.error,
      retry: distributions.retry,
    }),
    [basePathText, distributions],
  );
  const query = useRepositoryRows(entity, request, basePath);

  const { data, labelRefusal, lastShown } = useShownRows(query, params);
  const rows = useMemo(() => data?.results ?? [], [data]);
  const pastEnd = useLastPageWhenPastEnd(
    data,
    params,
    !query.isPlaceholderData,
  );
  // The label keys offered are those of the rows shown and, once the label
  // filter has been opened, those of every repository of the plugin.
  const [indexWanted, setIndexWanted] = useState(false);
  const openLabelFilter = useCallback(() => setIndexWanted(true), []);
  const repositoryIndex = useRepositoryIndex(entity, { enabled: indexWanted });
  const labelKeys = useMemo(
    () =>
      labelKeysOf([
        ...((data ?? lastShown.current)?.results ?? []),
        ...(repositoryIndex.data ?? []),
      ]),
    [data, repositoryIndex.data],
  );

  // The first read fills the whole screen with its state. Once something has
  // been shown, a read for another filter shows its state in place of the
  // table only, so the filters stay where they are being used.
  const everShown = useRef(false);
  if (data) {
    everShown.current = true;
  }

  const tasks = useTaskIndex();
  const versions = useVersionSummaries(
    rows.map((row) => row.latest_version_href),
  );

  // Whether the user may take an action on a row, and the notice of a failed
  // read of what they may do.
  const rowsShown = rows.length > 0 && !query.isPlaceholderData;
  const { permits, notice: permissionsNotice } = useRowPermits({
    names,
    needed: [
      ...actions.map(({ permission }) => permission),
      ...BULK_REPOSITORY_PERMISSIONS,
    ],
    objectRoles: manifest.permissions.objectRoles,
    rowsShown,
  });

  // The rows ticked for a bulk action: those of this page of this list, and
  // none once the address changes. The actions offered are those the user may
  // take on at least one of the selected rows, or on one of the rows of the
  // page while nothing is selected; a list in which none is offered has no
  // check boxes.
  const shownHrefs = useMemo(() => rows.map((row) => row.pulp_href), [rows]);
  const selection = usePageSelection(searchOf(params), shownHrefs);
  const { selected, toggle, toggleAll } = selection;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.pulp_href)),
    [rows, selected],
  );
  const pageBulkActions = repositoryBulkActions(descriptor, rows, permits);
  const selectable = pageBulkActions.length > 0;
  const bulkActions =
    selection.count > 0
      ? repositoryBulkActions(descriptor, selectedRows, permits)
      : pageBulkActions;
  // The repository whose delete dialog is open.
  const [deleting, setDeleting] = useState<RepositoryBase | null>(null);
  const requestDelete = useCallback(
    (row: RepositoryBase) => setDeleting(row),
    [],
  );
  // The repository whose sync dialog is open.
  const [syncing, setSyncing] = useState<RepositoryBase | null>(null);
  const requestSync = useCallback((row: RepositoryBase) => setSyncing(row), []);
  const actionContext = useMemo<RowActionContext>(
    () => ({ plugin, navigate, requestDelete, requestSync }),
    [plugin, navigate, requestDelete, requestSync],
  );

  const addButton = hasPermission(names.add) ? (
    <Button
      variant='primary'
      onClick={() => navigate(newRepositoryPath(plugin))}
    >
      {t`Add repository`}
    </Button>
  ) : undefined;

  // What other screens queued for this one is shown once, then forgotten.
  const { alerts, setAlerts } = useQueuedAlerts();

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  useRereadAlert(query, t`Repositories could not be displayed.`, setAlerts);

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
  const noData = !!data && data.count === 0 && !filterIsSet;

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
    actionsFor(actions, row, permits, descriptor)
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
  if (loading || pastEnd) {
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
          selectAll={
            selectable
              ? {
                  isSelected: selection.allSelected
                    ? true
                    : selection.count > 0
                      ? null
                      : false,
                  onSelect: toggleAll,
                  label: t`Select all repositories on this page`,
                }
              : undefined
          }
        />
        <RowActionsColumn.Provider value={anyRowAction}>
          <Tbody>
            {rows.map((row, position) => (
              <RepositoryRow
                key={row.pulp_href}
                row={row}
                position={position}
                selectable={selectable}
                selected={selected.has(row.pulp_href)}
                onToggle={toggle}
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
      {syncing ? (
        <SyncDialog
          key={syncing.pulp_href}
          descriptor={descriptor}
          repository={syncing}
          onClose={() => setSyncing(null)}
          onStarted={(task) => {
            const { name } = syncing;
            setAlerts((current) => [
              ...current,
              taskAlert(
                task,
                t`Sync started for repository "${name}".`,
                'success',
              ),
            ]);
          }}
        />
      ) : null}
      {deleting ? (
        <DeleteRepositoryDialog
          key={deleting.pulp_href}
          descriptor={descriptor}
          repository={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={(alert) => {
            // The rows are read again by the delete itself; the screen says
            // what was removed.
            setAlerts((current) => [...current, alert]);
            setDeleting(null);
          }}
        />
      ) : null}
      <ListLayout
        filters={
          <ListFilters
            filters={filters}
            params={params}
            updateParams={updateParams}
            labelKeys={labelKeys}
            labelRefusal={labelRefusal}
            onLabelFilterOpen={openLabelFilter}
            remotes={descriptor.remote?.entity}
          />
        }
        addButton={addButton}
        bulk={
          <RepositoryBulk
            descriptor={descriptor}
            selected={selectedRows}
            actions={bulkActions}
            permits={permits}
            index={distributions}
            onFinished={(alert) => setAlerts((current) => [...current, alert])}
          />
        }
        params={params}
        updateParams={updateParams}
        count={count}
        chips={
          <FilterChips
            filters={filters}
            params={params}
            updateParams={updateParams}
            remotes={descriptor.remote?.entity}
          />
        }
        notices={
          <>
            {query.baseMatches !== null && query.baseMatches > LARGE_MATCH ? (
              <Alert
                isInline
                variant='info'
                title={t`Many repositories match this base path`}
                style={{ marginBottom: '16px' }}
              >
                {t`More than ${LARGE_MATCH} repositories match. Add another filter to narrow the list.`}
              </Alert>
            ) : null}
            {permissionsNotice}
            <ColumnFailures failures={failures} />
          </>
        }
        content={content}
        hasRows={hasRows}
      />
    </>
  );
};

interface RowProps {
  row: RepositoryBase;
  // The row's place on the page, which names its check box for assistive
  // technology.
  position: number;
  // Whether the list has a column of check boxes, and whether this row's is
  // ticked. They are plain values so a change of the selection rebuilds only
  // the rows it touches.
  selectable: boolean;
  selected: boolean;
  onToggle: (href: string, checked: boolean) => void;
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
  position,
  selectable,
  selected,
  onToggle,
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
    <Tr data-cy={`RepositoryList-row-${row.name}`} isRowSelected={selected}>
      {selectable ? (
        <SelectCell
          id={`bulk-select-${position}`}
          label={t`Select ${row.name}`}
          checked={selected}
          onChange={(checked) => onToggle(row.pulp_href, checked)}
        />
      ) : null}
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
