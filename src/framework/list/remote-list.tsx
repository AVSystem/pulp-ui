import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
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
import type { EntityListParams, RemoteBase } from 'src/entities/plugin/model';
import { useEntityList } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import {
  BULK_REMOTE_PERMISSIONS,
  RemoteBulk,
  remoteBulkActions,
} from '../bulk/remote-bulk';
import { SelectCell } from '../bulk/select-cells';
import { usePageSelection } from '../bulk/selection';
import { DeleteRemoteDialog } from '../delete/delete-remote-dialog';
import type { ColumnDef, FilterDef, PluginDescriptor } from '../descriptor';
import { labelKeysOf } from '../labels/label-select';
import {
  type FrameworkPlugin,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';
import { newRemotePath } from '../route-patterns';
import { useQueuedAlerts } from '../use-queued-alerts';
import type { ColumnState } from './derived-columns';
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
import {
  REMOTE_ROW_ACTIONS,
  type RemoteActionContext,
  type RemoteRowAction,
} from './remote-row-actions';
import { UsedBy, type UsingRepository, useUsedBy } from './used-by';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  // The actions of a row's menu. Every list has the ones of
  // REMOTE_ROW_ACTIONS; a screen that adds actions passes its own list.
  actions?: RemoteRowAction[];
}

const NO_COLUMNS: ColumnDef<RemoteBase>[] = [];
const NO_FILTERS: FilterDef[] = [];
const NO_ACTION_IDS = '';

// What every list reads of a remote whatever its columns are: the address a row
// is held by, the name it is linked by and the labels the bulk actions decide
// on.
const BASE_FIELDS = ['pulp_href', 'name', 'pulp_labels'];

const noop = () => undefined;

// The generic list of a plugin's remotes. The address holds the page, its
// size, the order and the filters, and the screen shows exactly what it says.
// The rows come from one read of the page; the repositories that use each
// remote come from the one read of the plugin's repositories that its other
// screens share, so the number of requests does not grow with the rows. A
// column whose read fails says so with a Retry and leaves the rows alone.
export const RemoteList = ({
  plugin,
  descriptor,
  actions = REMOTE_ROW_ACTIONS,
}: Props) => {
  const { remote } = descriptor;

  if (!remote) {
    throw new Error(
      `The ${plugin} descriptor declares no remotes, which a list of them needs`,
    );
  }

  return (
    <RemoteListScreen
      plugin={plugin}
      descriptor={descriptor}
      actions={actions}
      remote={remote}
    />
  );
};

const RemoteListScreen = ({
  plugin,
  descriptor,
  actions = REMOTE_ROW_ACTIONS,
  remote,
}: Props & { remote: NonNullable<PluginDescriptor['remote']> }) => {
  const navigate = useNavigate();
  const { hasPermission } = useAppContext();
  const { entity, columns = NO_COLUMNS, filters = NO_FILTERS } = remote;
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const names = manifest.permissions.remote;

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
    } as EntityListParams;
  }, [params, fields]);

  const query = useEntityList(entity, request);
  const { data, labelRefusal } = useShownRows(query, params);
  const rows = useMemo(() => data?.results ?? [], [data]);
  const pastEnd = useLastPageWhenPastEnd(
    data,
    params,
    !query.isPlaceholderData,
  );
  // The label keys offered are those of the rows shown.
  const labelKeys = useMemo(() => labelKeysOf(rows), [rows]);

  // The first read fills the whole screen with its state. Once something has
  // been shown, a read for another filter shows its state in place of the
  // table only, so the filters stay where they are being used.
  const everShown = useRef(false);
  if (data) {
    everShown.current = true;
  }

  const rowsShown = rows.length > 0 && !query.isPlaceholderData;
  const usedBy = useUsedBy(descriptor.repository.entity, {
    enabled: rowsShown,
  });
  const { permits, notice: permissionsNotice } = useRowPermits({
    names,
    needed: [
      ...actions.map(({ permission }) => permission),
      ...BULK_REMOTE_PERMISSIONS,
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
  const pageBulkActions = remoteBulkActions(rows, permits);
  const selectable = pageBulkActions.length > 0;
  const bulkActions =
    selection.count > 0
      ? remoteBulkActions(selectedRows, permits)
      : pageBulkActions;
  // The remote whose delete dialog is open.
  const [deleting, setDeleting] = useState<RemoteBase | null>(null);
  const requestDelete = useCallback((row: RemoteBase) => setDeleting(row), []);
  const actionContext = useMemo<RemoteActionContext>(
    () => ({ plugin, navigate, requestDelete }),
    [plugin, navigate, requestDelete],
  );

  const addButton = hasPermission(names.add) ? (
    <Button variant='primary' onClick={() => navigate(newRemotePath(plugin))}>
      {t`Add remote`}
    </Button>
  ) : undefined;

  // What other screens queued for this one is shown once, then forgotten.
  const { alerts, setAlerts } = useQueuedAlerts();

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  useRereadAlert(query, t`Remotes could not be displayed.`, setAlerts);

  const header = <BaseHeader title={t`Remotes`} />;
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
            title={t`Remotes could not be displayed.`}
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
          title={t`No remotes yet`}
          description={t`Remotes will appear once created.`}
          button={addButton}
        />
      </>
    );
  }

  const settled = usedBy.state !== 'loading';
  const failures =
    usedBy.state === 'error'
      ? [
          {
            id: 'used-by',
            title: t`Repositories using the remotes could not be read.`,
            retry: usedBy.retry,
            description: requestErrorDescription(usedBy.error),
          },
        ]
      : [];

  // The actions each row offers, by id, so a row is rebuilt only when its own
  // actions change. A list in which no row offers one has no actions column.
  const rowActionIds = rows.map((row) =>
    actions
      .filter(({ permission }) => permits(permission, row))
      .map(({ id }) => id)
      .join(','),
  );
  const anyRowAction = rowActionIds.some((ids) => ids !== NO_ACTION_IDS);

  const headers = [
    ...columns.map((column: ColumnDef<RemoteBase>) => ({
      id: column.sortField ?? column.id,
      title: i18n._(column.label),
      type: column.sortField ? (column.sortKind ?? 'alpha') : 'none',
    })),
    { id: 'used-by', title: t`Used by`, type: 'none' },
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
        title={t`Remotes could not be displayed.`}
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
        aria-label={t`Remotes`}
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
                  label: t`Select all remotes on this page`,
                }
              : undefined
          }
        />
        <RowActionsColumn.Provider value={anyRowAction}>
          <Tbody>
            {rows.map((row, position) => (
              <RemoteRow
                key={row.pulp_href}
                plugin={plugin}
                row={row}
                position={position}
                selectable={selectable}
                selected={selected.has(row.pulp_href)}
                onToggle={toggle}
                columns={columns}
                actions={actions}
                actionIds={rowActionIds[position] as string}
                actionContext={actionContext}
                usedByState={usedBy.state}
                users={usedBy.of(row.pulp_href)}
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
      {deleting ? (
        <DeleteRemoteDialog
          key={deleting.pulp_href}
          descriptor={descriptor}
          remote={deleting}
          onClose={() => setDeleting(null)}
          onAccepted={(alert) => {
            // The task is followed from the application root, which reads the
            // remotes again when it ends; this screen says that it started.
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
            onLabelFilterOpen={noop}
          />
        }
        addButton={addButton}
        bulk={
          <RemoteBulk
            descriptor={descriptor}
            selected={selectedRows}
            actions={bulkActions}
            permits={permits}
            usedBy={usedBy.of}
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
          />
        }
        notices={
          <>
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
  plugin: FrameworkPlugin;
  row: RemoteBase;
  // The row's place on the page, which names its check box for assistive
  // technology.
  position: number;
  // Whether the list has a column of check boxes, and whether this row's is
  // ticked. They are plain values so a change of the selection rebuilds only
  // the rows it touches.
  selectable: boolean;
  selected: boolean;
  onToggle: (href: string, checked: boolean) => void;
  columns: ColumnDef<RemoteBase>[];
  actions: RemoteRowAction[];
  // The ids of the actions the row offers, joined by commas.
  actionIds: string;
  actionContext: RemoteActionContext;
  usedByState: ColumnState;
  users: readonly UsingRepository[];
}

// One row. It is rebuilt only when what it shows changes, so a shared read that
// settles redraws the rows it has something new for and not every row of a page
// of 500.
const RemoteRow = memo(function RemoteRow({
  plugin,
  row,
  position,
  selectable,
  selected,
  onToggle,
  columns,
  actions,
  actionIds,
  actionContext,
  usedByState,
  users,
}: RowProps) {
  return (
    <Tr data-cy={`RemoteList-row-${row.name}`} isRowSelected={selected}>
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
        <UsedBy
          plugin={plugin}
          remote={row.pulp_href}
          state={usedByState}
          users={users}
        />
      </Td>
      <ListItemActions
        kebabItems={actions
          .filter(({ id }) => actionIds.split(',').includes(id))
          .map((action) => action.item(row, actionContext))}
      />
    </Tr>
  );
});
