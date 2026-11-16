import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody } from '@patternfly/react-table';
import { type ReactNode, useEffect, useState } from 'react';
import {
  AppliedFilters,
  CompoundFilter,
  EmptyStateFilter,
  EmptyStateNoData,
  type FilterOption,
  LoadingSpinner,
  type LocalizedSortHeaders,
  PulpPagination,
  type Query,
  type RenderTableRow,
  SortTable,
  Table,
} from 'src/components';
import { type ActionType } from '../actions/action';
import { useSessionEpoch } from '../user-context';
import { filterIsSet } from '../utilities/filter-is-set';
import {
  isSessionEnd,
  requestErrorDescription,
} from '../utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IProps<T> {
  actionContext: {
    addAlert;
    hasObjectPermission?;
    hasPermission;
    query;
    // loads the page around the list again, for an action that changes
    // what the page shows
    reloadPage?: () => void;
    setState?;
    state?;
  };
  // marks the table as busy for assistive technology while the screen around
  // the list still reads data the rows depend on
  busy?: boolean;
  defaultPageSize: number;
  defaultSort?: string;
  errorTitle: string;
  filterConfig?: FilterOption[];
  headerActions?: ActionType[];
  listItemActions?: ActionType[];
  noDataButton?: (item, actionContext) => ReactNode;
  noDataDescription: string;
  noDataTitle: string;
  // Loads again after a failed load. Without it the list repeats its own
  // query, which is not enough when the failed data came from the page.
  onRetry?: () => void;
  query: Query<T>;
  renderTableRow: RenderTableRow<T>;
  sortHeaders: LocalizedSortHeaders;
  title: string;
}

export function DetailList<T>({
  actionContext,
  busy,
  defaultPageSize,
  defaultSort,
  errorTitle,
  filterConfig,
  headerActions,
  listItemActions,
  noDataButton,
  noDataDescription,
  noDataTitle,
  onRetry,
  query,
  renderTableRow,
  sortHeaders,
  title,
}: IProps<T>) {
  const [items, setItems] = useState<T[]>([]);
  const [params, setParams] = useState({
    page: 1,
    page_size: defaultPageSize,
    sort: defaultSort,
  });
  const [inputText, setInputText] = useState('');
  const [itemCount, setItemCount] = useState(0);
  const [loading, setLoading] = useState(true);
  // why the last load failed; null while the list is loading or loaded
  const [error, setError] = useState<ReactNode>(null);
  // counts the retries asked for, so the same parameters load again
  const [attempt, setAttempt] = useState(0);
  // grows when the same user signs in again, so the list reads again
  const epoch = useSessionEpoch();

  useEffect(() => {
    // a load that is no longer the current one must not change the list
    let current = true;

    // an error state has no rows to keep, so it reads again like a first load
    if (error) {
      setLoading(true);
    }
    setError(null);
    query({ params })
      .then(({ data: { count, results } }) => {
        if (current) {
          setItems(results);
          setItemCount(count);
          setLoading(false);
        }
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it. The list keeps
        // its loading state or its rows and reads again after signing in.
        if (current && !isSessionEnd(e)) {
          setItems([]);
          setItemCount(0);
          setError(requestErrorDescription(e));
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [params, attempt, epoch]);

  const renderModals = (actionContext) => (
    <>
      {headerActions?.length
        ? headerActions.map((action) => action?.modal?.(actionContext))
        : null}
      {listItemActions?.length
        ? listItemActions.map((action) => action?.modal?.(actionContext))
        : null}
    </>
  );

  // Only actions that are shown get a toolbar item, so a hidden action leaves
  // no empty item behind.
  const shownHeaderActions = (headerActions || []).filter((action) =>
    action.isShown(null, actionContext),
  );

  // The button of the empty state, or nothing when the action is hidden, so
  // the empty state never holds an empty actions area.
  const emptyStateButtonContent = noDataButton?.(null, actionContext);
  const emptyStateButton = emptyStateButtonContent ? (
    <>{emptyStateButtonContent}</>
  ) : undefined;

  const knownFilters = (filterConfig || []).map(({ id }) => id);
  const noData = items.length === 0 && !filterIsSet(params, knownFilters);

  const niceNames = Object.fromEntries(
    (filterConfig || []).map(({ id, title }) => [id, title]),
  );

  return (
    <>
      {renderModals?.(actionContext)}
      {error && !loading ? (
        <ListErrorState
          title={errorTitle}
          message={error}
          onRetry={() => {
            if (onRetry) {
              onRetry();
              return;
            }
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
        />
      ) : noData && !loading ? (
        <EmptyStateNoData
          button={emptyStateButton}
          description={noDataDescription}
          title={noDataTitle}
        />
      ) : loading ? (
        <LoadingSpinner />
      ) : (
        <>
          <div className='pulp-toolbar' data-cy={`DetailList`}>
            <Toolbar>
              <ToolbarContent>
                <ToolbarGroup>
                  <ToolbarItem>
                    <CompoundFilter
                      inputText={inputText}
                      onChange={setInputText}
                      updateParams={setParams}
                      params={params}
                      filterConfig={filterConfig || []}
                    />
                  </ToolbarItem>
                  {shownHeaderActions.map((action) => (
                    <ToolbarItem key={action.title}>
                      {action.button(null, actionContext)}
                    </ToolbarItem>
                  ))}
                </ToolbarGroup>
              </ToolbarContent>
            </Toolbar>

            <PulpPagination
              params={params}
              updateParams={setParams}
              count={itemCount}
              isTop
            />
          </div>
          <div>
            <AppliedFilters
              updateParams={(p) => {
                setParams(p);
                setInputText('');
              }}
              params={params}
              ignoredParams={['page_size', 'page', 'sort', 'ordering']}
              niceNames={niceNames}
            />
          </div>
          {loading ? (
            <LoadingSpinner />
          ) : !items.length ? (
            <EmptyStateFilter />
          ) : (
            <Table aria-busy={busy} aria-label={title}>
              <SortTable
                options={{ headers: sortHeaders }}
                params={params}
                updateParams={setParams}
              />
              <Tbody>
                {items.map((item, i) =>
                  renderTableRow(item, i, actionContext, listItemActions),
                )}
              </Tbody>
            </Table>
          )}
          <PulpPagination
            params={params}
            updateParams={setParams}
            count={itemCount}
          />
        </>
      )}
    </>
  );
}
