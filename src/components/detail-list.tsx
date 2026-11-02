import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Tbody } from '@patternfly/react-table';
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
} from 'src/components';
import { type ActionType } from '../actions/action';
import { filterIsSet } from '../utilities/filter-is-set';
import { requestErrorDescription } from '../utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IProps<T> {
  actionContext: {
    addAlert;
    hasObjectPermission?;
    hasPermission;
    query;
    setState?;
    state?;
  };
  defaultPageSize: number;
  defaultSort?: string;
  errorTitle: string;
  filterConfig?: FilterOption[];
  headerActions?: ActionType[];
  listItemActions?: ActionType[];
  noDataButton?: (item, actionContext) => ReactNode;
  noDataDescription: string;
  noDataTitle: string;
  query: Query<T>;
  renderTableRow: RenderTableRow<T>;
  sortHeaders: LocalizedSortHeaders;
  title: string;
}

export function DetailList<T>({
  actionContext,
  defaultPageSize,
  defaultSort,
  errorTitle,
  filterConfig,
  headerActions,
  listItemActions,
  noDataButton,
  noDataDescription,
  noDataTitle,
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

  useEffect(() => {
    // a load that is no longer the current one must not change the list
    let current = true;

    setError(null);
    query({ params })
      .then(({ data: { count, results } }) => {
        if (current) {
          setItems(results);
          setItemCount(count);
        }
      })
      .catch((e) => {
        if (current) {
          setItems([]);
          setItemCount(0);
          setError(requestErrorDescription(e));
        }
      })
      .then(() => {
        if (current) {
          setLoading(false);
        }
      });

    return () => {
      current = false;
    };
  }, [params, attempt]);

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
            setLoading(true);
            setAttempt((n) => n + 1);
          }}
        />
      ) : noData && !loading ? (
        <EmptyStateNoData
          button={<>{noDataButton?.(null, actionContext)}</>}
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
                  {headerActions?.length &&
                    headerActions.map((action) => (
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
            <Table aria-label={title}>
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
