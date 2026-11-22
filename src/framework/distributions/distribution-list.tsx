import { t } from '@lingui/core/macro';
import { Skeleton } from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { memo, useMemo, useRef } from 'react';
import {
  AlertList,
  BaseHeader,
  CopyURL,
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
import {
  useDistributionPage,
  useDistributionUrls,
} from 'src/entities/core/distribution/queries';
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

// The order and the sorting of the list. The server orders the whole list, so
// each column that has a field sorts by it. The URL is read from the plugins
// and never sorts.
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

type UrlState = 'loading' | 'ready' | 'error';

// The address a client of the row's plugin reaches the distribution at. It
// comes from the plugin's own read of the page, so it says that it is still on
// its way or could not be read instead of reading as "none".
const UrlCell = ({
  state,
  url,
}: {
  state: UrlState;
  url: string | null | undefined;
}) => {
  if (state === 'loading') {
    return <Skeleton width='70%' />;
  }
  if (state === 'error') {
    return <>{t`Not loaded`}</>;
  }

  return url ? <CopyURL url={url} /> : <>{t`None`}</>;
};

interface RowProps {
  row: ListedDistribution;
  urlState: UrlState;
  url: string | null | undefined;
}

// One row. It is rebuilt only when what it shows changes, so the read of the
// client addresses settling redraws the rows it has something new for.
const DistributionRow = memo(function DistributionRow({
  row,
  urlState,
  url,
}: RowProps) {
  return (
    <Tr data-cy={`DistributionList-row-${row.name}`}>
      <Td>{row.name}</Td>
      <Td>{row.plugin ? pluginLabel(row.plugin) : row.typeName}</Td>
      <Td>{row.base_path}</Td>
      <Td>
        {row.plugin ? <UrlCell state={urlState} url={url} /> : <>{t`None`}</>}
      </Td>
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
  const urls = useDistributionUrls(rows);

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

  const urlState: UrlState =
    urls.status === 'pending'
      ? 'loading'
      : urls.status === 'error'
        ? 'error'
        : 'ready';
  const settled = urlState !== 'loading';
  const failures =
    urlState === 'error' && !isSessionEnd(urls.error)
      ? [
          {
            id: 'url',
            title: t`Client URLs could not be read.`,
            retry: urls.retry,
            description: requestErrorDescription(urls.error),
          },
        ]
      : [];

  const headers = [
    { id: 'name', title: t`Name`, type: 'alpha' },
    { id: 'pulp_type', title: t`Plugin`, type: 'alpha' },
    { id: 'base_path', title: t`Base path`, type: 'alpha' },
    { id: 'url', title: t`URL`, type: 'none' },
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
              urlState={urlState}
              url={urls.urls?.get(row.pulp_href)}
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
