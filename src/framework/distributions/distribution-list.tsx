import { t } from '@lingui/core/macro';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useMemo, useRef } from 'react';
import {
  AlertList,
  BaseHeader,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  ListErrorState,
  LoadingSpinner,
  Main,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import {
  DISTRIBUTION_TYPES,
  type DistributionPlugin,
  type ListedDistribution,
} from 'src/entities/core/distribution/page';
import { useDistributionPage } from 'src/entities/core/distribution/queries';
import { usePlugins } from 'src/plugins';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import {
  ColumnFailures,
  ListLayout,
  useLastPageWhenPastEnd,
  useListAddress,
  useRereadAlert,
  useShownRows,
} from '../list/list-frame';
import { PLUGIN_MANIFESTS } from '../manifest';
import { useQueuedAlerts } from '../use-queued-alerts';
import {
  GuardCell,
  ServedCell,
  ServesCell,
  UrlCell,
} from './distribution-columns';
import {
  type DistributionCells,
  useDistributionColumns,
} from './use-distribution-columns';

// The order and the sorting of the list. The server orders the whole list, so
// each column that has a field sorts by it. The columns that are read from the
// plugins, the repositories, the publications and the guards never sort.
const SORTABLE = [
  { sortField: 'name' },
  { sortField: 'pulp_type' },
  { sortField: 'base_path' },
];
const NO_FILTERS: never[] = [];

const PLUGINS = Object.keys(DISTRIBUTION_TYPES) as DistributionPlugin[];

// The name a row's plugin is shown under.
function pluginLabel(plugin: DistributionPlugin): string {
  if (plugin === 'file') {
    return t`File`;
  }

  return (
    PLUGIN_MANIFESTS.find((manifest) => manifest.plugin === plugin)?.label ??
    plugin
  );
}

interface RowProps {
  row: ListedDistribution;
  cells: DistributionCells;
}

// One row. It is rebuilt only when what it shows changes, so the reads behind
// the columns settling redraw the rows they have something new for.
const DistributionRow = memo(function DistributionRow({
  row,
  cells,
}: RowProps) {
  const owned = row.plugin !== null;

  return (
    <Tr data-cy={`DistributionList-row-${row.name}`}>
      <Td>{row.name}</Td>
      <Td>{row.plugin ? pluginLabel(row.plugin) : row.typeName}</Td>
      <Td>{row.base_path}</Td>
      <Td>
        <UrlCell cells={cells} ofPlugin={owned} />
      </Td>
      <Td>
        {owned ? <ServesCell cells={cells} plugin={row.plugin} /> : t`None`}
      </Td>
      <Td>
        <GuardCell cells={cells} />
      </Td>
      <Td>{owned ? <ServedCell cells={cells} /> : t`None`}</Td>
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
  const { params, updateParams } = useListAddress(SORTABLE, NO_FILTERS);

  const request = useMemo(
    () => ({
      plugins: installed,
      page: params.page,
      page_size: params.page_size,
      sort: params.sort,
    }),
    [installed, params.page, params.page_size, params.sort],
  );
  const query = useDistributionPage(request);

  const { data } = useShownRows(query, params);
  const rows = useMemo(() => data?.results ?? [], [data]);
  const pastEnd = useLastPageWhenPastEnd(
    data,
    params,
    !query.isPlaceholderData,
  );
  const columns = useDistributionColumns(rows);

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
  if (!!data && data.count === 0) {
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

  const headers = [
    { id: 'name', title: t`Name`, type: 'alpha' },
    { id: 'pulp_type', title: t`Plugin`, type: 'alpha' },
    { id: 'base_path', title: t`Base path`, type: 'alpha' },
    { id: 'url', title: t`URL`, type: 'none' },
    { id: 'serves', title: t`Serves`, type: 'none' },
    { id: 'guard', title: t`Content guard`, type: 'none' },
    { id: 'served', title: t`Served state`, type: 'none' },
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
        <Tbody>
          {rows.map((row) => (
            <DistributionRow
              key={row.pulp_href}
              row={row}
              cells={columns.cellsOf(row)}
            />
          ))}
        </Tbody>
      </Table>
    );
  }

  return (
    <>
      {alertList}
      {header}
      <ListLayout
        filters={null}
        addButton={undefined}
        params={params}
        updateParams={updateParams}
        count={count}
        chips={null}
        notices={<ColumnFailures failures={failures} />}
        content={content}
        hasRows={hasRows}
      />
    </>
  );
};
