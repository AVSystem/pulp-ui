import { t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AlertList,
  BaseHeader,
  DateComponent,
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
import {
  DISTRIBUTION_TYPES,
  type DistributionPlugin,
  type ListedDistribution,
} from 'src/entities/core/distribution/page';
import {
  useDistributionRows,
  usePublicDistributions,
} from 'src/entities/core/distribution/queries';
import { usePlugins } from 'src/plugins';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { labelKeysOf } from '../labels/label-select';
import {
  ColumnFailures,
  ListLayout,
  PermissionsNotice,
  useLastPageWhenPastEnd,
  useListAddress,
  useRereadAlert,
  useShownRows,
} from '../list/list-frame';
import { distributionPath } from '../route-patterns';
import { useQueuedAlerts } from '../use-queued-alerts';
import { DeleteDistributionDialog } from './delete-distribution-dialog';
import {
  GuardCell,
  NameCell,
  ServedCell,
  ServesCell,
  UrlCell,
} from './distribution-columns';
import {
  DISTRIBUTION_FILTERS,
  DistributionFilterChips,
  DistributionFilters,
  listedPlugins,
  publicOnlyOf,
} from './distribution-filters';
import { pluginLabel } from './plugin-label';
import {
  type DistributionCells,
  useDistributionColumns,
} from './use-distribution-columns';
import { useDistributionPermits } from './use-distribution-permission';

// The order and the sorting of the list. The server orders the whole list, so
// each column that has a field sorts by it. The columns that are read from the
// plugins, the repositories, the publications and the guards never sort.
const SORTABLE = [
  { sortField: 'name' },
  { sortField: 'pulp_type' },
  { sortField: 'base_path' },
  { sortField: 'pulp_created' },
];
const NEEDED_PERMISSIONS = ['delete'] as const;

const PLUGINS = Object.keys(DISTRIBUTION_TYPES) as DistributionPlugin[];

interface RowProps {
  row: ListedDistribution;
  cells: DistributionCells;
  // whether the user may delete this distribution
  canDelete: boolean;
  requestDelete: (row: ListedDistribution) => void;
}

// One row. It is rebuilt only when what it shows changes, so the reads behind
// the columns settling redraw the rows they have something new for.
const DistributionRow = memo(function DistributionRow({
  row,
  cells,
  canDelete,
  requestDelete,
}: RowProps) {
  const owned = row.plugin !== null;

  return (
    <Tr data-cy={`DistributionList-row-${row.name}`}>
      <Td>
        <NameCell plugin={row.plugin} name={row.name} />
      </Td>
      <Td>{row.plugin ? pluginLabel(row.plugin) : row.typeName}</Td>
      <Td>{row.base_path}</Td>
      <Td>
        <UrlCell
          cells={cells}
          ofPlugin={owned}
          detail={
            row.plugin ? distributionPath(row.plugin, row.name) : undefined
          }
        />
      </Td>
      <Td>
        {owned ? <ServesCell cells={cells} plugin={row.plugin} /> : t`None`}
      </Td>
      <Td>
        <GuardCell cells={cells} />
      </Td>
      <Td>{owned ? <ServedCell cells={cells} /> : t`None`}</Td>
      <Td>
        <DateComponent date={row.pulp_created ?? ''} />
      </Td>
      <ListItemActions
        kebabItems={
          canDelete
            ? [
                <DropdownItem key='delete' onClick={() => requestDelete(row)}>
                  {t`Delete`}
                </DropdownItem>,
              ]
            : []
        }
      />
    </Tr>
  );
});

// The list of the distributions of every installed plugin that has them. The
// address holds the page, its size and the order, and the screen shows exactly
// what it says. The rows come from one read of the page, limited to the types
// of the installed plugins; the address a client reaches each one at comes from
// the plugins' own reads of the page in groups, so the number of requests does
// not grow with the rows. A column whose read fails says so with a Retry and
// leaves the rows alone.
export const DistributionList = () => {
  const plugins = usePlugins();

  if (plugins.state === 'loading' || plugins.state === 'idle') {
    return (
      <>
        <BaseHeader title={t`Distributions`} />
        <Main>
          <LoadingSpinner />
        </Main>
      </>
    );
  }
  if (plugins.state === 'error') {
    // Which plugins are installed decides what is asked for; without an answer
    // nothing is asked.
    return (
      <>
        <BaseHeader title={t`Distributions`} />
        <Main>
          <ListErrorState
            title={t`The plugin list could not be loaded`}
            message={requestErrorDescription(plugins.error)}
            onRetry={plugins.retry}
          />
        </Main>
      </>
    );
  }

  return (
    <DistributionListScreen
      installed={PLUGINS.filter((plugin) => plugins.versions.has(plugin))}
    />
  );
};

const DistributionListScreen = ({
  installed,
}: {
  installed: readonly DistributionPlugin[];
}) => {
  const { params, filterIsSet, updateParams } = useListAddress(
    SORTABLE,
    DISTRIBUTION_FILTERS,
  );

  // The filters the server applies come from the address as they are; the
  // plugins chosen decide which types are asked for.
  const plugins = useMemo(
    () => listedPlugins(params, installed),
    [params, installed],
  );
  const { name__icontains, base_path__icontains, pulp_label_select } = params;
  const request = useMemo(
    () => ({
      plugins,
      page: params.page,
      page_size: params.page_size,
      sort: params.sort,
      ...(typeof name__icontains === 'string' ? { name__icontains } : {}),
      ...(typeof base_path__icontains === 'string'
        ? { base_path__icontains }
        : {}),
      ...(typeof pulp_label_select === 'string' ? { pulp_label_select } : {}),
    }),
    [
      plugins,
      params.page,
      params.page_size,
      params.sort,
      name__icontains,
      base_path__icontains,
      pulp_label_select,
    ],
  );
  // With the public filter on, the distributions that have no content guard
  // are found in the indexes of the plugins listed, which read every
  // distribution of each.
  const publicOnly = publicOnlyOf(params);
  const publicIndex = usePublicDistributions(plugins, publicOnly);
  const selection = useMemo(
    () => ({
      enabled: publicOnly,
      hrefs: publicIndex.hrefs,
      status: publicIndex.status,
      error: publicIndex.error,
      retry: publicIndex.retry,
    }),
    [publicOnly, publicIndex],
  );
  const query = useDistributionRows(request, selection);

  const { data, labelRefusal, lastShown } = useShownRows(query, params);
  const rows = useMemo(() => data?.results ?? [], [data]);
  // The label keys offered are those of the rows shown.
  const labelKeys = useMemo(
    () => labelKeysOf((data ?? lastShown.current)?.results ?? []),
    [data, lastShown],
  );
  const pastEnd = useLastPageWhenPastEnd(
    data,
    params,
    !query.isPlaceholderData,
  );
  const columns = useDistributionColumns(rows);

  // What the user may do with each row, by the permission of the row's own
  // plugin.
  const rowsShown = rows.length > 0 && !query.isPlaceholderData;
  const { permits, failure: permissionsFailure } = useDistributionPermits({
    rows,
    needed: NEEDED_PERMISSIONS,
    rowsShown,
  });
  // The distribution whose delete dialog is open.
  const [deleting, setDeleting] = useState<ListedDistribution | null>(null);
  const requestDelete = useCallback(
    (row: ListedDistribution) => setDeleting(row),
    [],
  );

  // The first read fills the whole screen with its state. Once something has
  // been shown, a read for another page shows its state in place of the table
  // only.
  const everShown = useRef(false);
  if (data) {
    everShown.current = true;
  }

  const { alerts, setAlerts } = useQueuedAlerts();
  useRereadAlert(query, t`Distributions could not be displayed.`, setAlerts);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  const header = <BaseHeader title={t`Distributions`} />;
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
            title={t`Distributions could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }
  if (!!data && data.count === 0 && !filterIsSet) {
    return (
      <>
        {alertList}
        {header}
        <EmptyStateNoData
          title={t`No distributions yet`}
          description={t`Distributions will appear once created.`}
        />
      </>
    );
  }

  const { settled, failures } = columns;

  // The rows that offer an action. A list in which none does has no actions
  // column.
  const deletable = rows.map((row) => permits('delete', row));
  const anyRowAction = deletable.some(Boolean);

  const headers = [
    { id: 'name', title: t`Name`, type: 'alpha' },
    { id: 'pulp_type', title: t`Plugin`, type: 'alpha' },
    { id: 'base_path', title: t`Base path`, type: 'alpha' },
    { id: 'url', title: t`URL`, type: 'none' },
    { id: 'serves', title: t`Serves`, type: 'none' },
    { id: 'guard', title: t`Content guard`, type: 'none' },
    { id: 'served', title: t`Served state`, type: 'none' },
    { id: 'pulp_created', title: t`Created date`, type: 'numeric' },
    ...(anyRowAction ? [{ id: 'actions', title: '', type: 'none' }] : []),
  ];

  const count = data?.count ?? 0;
  const hasRows = !!data && rows.length > 0;

  // What the table's place shows: the rows, the way out of a page that has
  // none, or the state of a read that is still on its way or failed.
  let content;
  if (loading || pastEnd) {
    content = <LoadingSpinner />;
  } else if (failed) {
    content = (
      <ListErrorState
        title={t`Distributions could not be displayed.`}
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
        aria-label={t`Distributions`}
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
              <DistributionRow
                key={row.pulp_href}
                row={row}
                cells={columns.cellsOf(row)}
                canDelete={deletable[position] as boolean}
                requestDelete={requestDelete}
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
      {deleting?.plugin ? (
        <DeleteDistributionDialog
          key={deleting.pulp_href}
          plugin={deleting.plugin}
          distribution={deleting}
          onClose={() => setDeleting(null)}
          onAccepted={(alert) => {
            // The task is followed from the application root, which reads the
            // list again when it ends; this screen says that it started.
            setAlerts((current) => [...current, alert]);
            setDeleting(null);
          }}
        />
      ) : null}
      <ListLayout
        filters={
          <DistributionFilters
            params={params}
            updateParams={updateParams}
            installed={installed}
            labelKeys={labelKeys}
            labelRefusal={labelRefusal}
          />
        }
        addButton={undefined}
        params={params}
        updateParams={updateParams}
        count={count}
        chips={
          <DistributionFilterChips
            params={params}
            updateParams={updateParams}
            installed={installed}
          />
        }
        notices={
          <>
            {publicOnly ? (
              <Alert
                isInline
                variant='info'
                title={t`Reading every distribution to find the public ones`}
                style={{ marginBottom: '16px' }}
              >
                {t`A distribution is public when it has no content guard. Only those are listed.`}
              </Alert>
            ) : null}
            {permissionsFailure ? (
              <PermissionsNotice
                description={permissionsFailure.description}
                retry={permissionsFailure.retry}
              />
            ) : null}
            <ColumnFailures failures={failures} />
          </>
        }
        content={content}
        hasRows={hasRows}
      />
    </>
  );
};
