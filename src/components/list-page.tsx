import { type MessageDescriptor, i18n } from '@lingui/core';
import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody } from '@patternfly/react-table';
import { Component, type ReactNode } from 'react';
import { AppContext, type IAppContextType } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  CompoundFilter,
  EmptyStateFilter,
  EmptyStateNoData,
  type FilterOption,
  InsufficientPermissions,
  LoadingSpinner,
  Main,
  PulpPagination,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { type ActionType } from '../actions/action';
import { filterIsSet } from '../utilities/filter-is-set';
import {
  ObjectPermissions,
  needsObjectPermissions,
} from '../utilities/my-permissions';
import { ParamHelper } from '../utilities/param-helper';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from '../utilities/request-error';
import { type RouteProps, withRouter } from '../utilities/with-router';
import { ListErrorState } from './list-error-state';
import { RowActionsColumn } from './list-item-actions';

interface IState<T> {
  params: {
    page?: number;
    page_size?: number;
  };
  loading: boolean;
  items: T[];
  itemCount: number;
  alerts: AlertType[];
  // why the last load failed; null while the list is loading or loaded
  error: ReactNode;
  unauthorized: boolean;
  // the reason Pulp gave for refusing the read, when it gave one
  unauthorizedDetail: string | null;
  inputText: string;
  selectedFilter: string;
}

// states:
// loading - initial state, only Main + spinner, header and alerts
// unauthorized - only InsufficientPermissions, header and alerts: the read was
//   refused (403) or the screen's condition does not hold
// error - the load failed, only ListErrorState with a retry, header and alerts
// noData - no data at all, EmptyStateNoData with possible buttons
// !items.length - no visible data but a filter is on, EmptyStateFilter with a clear filters button, CompoundFilter + AppliedFilters
// (data) - also renders SortTable

interface ParamsType {
  page?: number;
  page_size?: number;
}

export type Query<T> = (o: {
  params?: ParamsType;
}) => Promise<{ data: { count: number; results: T[] } }>;

export type RenderTableRow<T> = (
  item: T,
  index: number,
  { addAlert, setState }: { addAlert; setState? },
  listItemActions?,
) => ReactNode;

type SortHeaders = {
  title: MessageDescriptor;
  type: string;
  id: string;
  className?: string;
}[];

export type LocalizedSortHeaders = {
  title: string;
  type: string;
  id: string;
  className?: string;
}[];

interface ListPageParams<T> {
  condition?: (context) => boolean;
  defaultPageSize: number;
  defaultSort?: string;
  displayName: string;
  errorTitle: MessageDescriptor;
  filterConfig: ({ state }) => FilterOption[];
  headerActions?: ActionType[];
  listItemActions?: ActionType[];
  noDataButton?: (item, actionContext) => ReactNode;
  noDataDescription: MessageDescriptor;
  noDataTitle: MessageDescriptor;
  query: Query<T>;
  renderTableRow: RenderTableRow<T>;
  sortHeaders: SortHeaders;
  title: MessageDescriptor;
  typeaheadQuery?: ({ inputText, selectedFilter, setState }) => void;
}

export const ListPage = function <T>({
  // receives the app context (user, hasPermission, ...) => bool
  condition,
  // component name for debugging
  displayName,
  // initial page size
  defaultPageSize,
  // initial sort ordering
  defaultSort,
  // alert on query failure
  errorTitle,
  // filters
  filterConfig,
  // displayed after filters
  headerActions,
  // only used for modals; renderTableRow handles the rest
  listItemActions,
  // EmptyStateNoData
  noDataButton,
  noDataDescription,
  noDataTitle,
  // ({ params }) => Promise<{ data: { count, results[] } }>
  query,
  // (item, index) => <Tr>...</Tr>
  renderTableRow,
  // table headers
  sortHeaders,
  // container title
  title,
  // for typeahed filters
  typeaheadQuery,
}: ListPageParams<T>) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const translateTitle = ({ title, ...rest }: any) => ({
    ...rest,
    title: i18n._(title),
  });

  const klass = class extends Component<RouteProps, IState<T>> {
    static displayName = displayName;
    static contextType = AppContext;

    // number of the latest load; the answer of an older load is ignored
    private latestQuery = 0;

    // what the server lists for each row's object, read for the rows of this
    // page load when a row action can only be decided by it
    private objectPermissions = new ObjectPermissions(() => this.forceUpdate());

    constructor(props) {
      super(props);

      const params = ParamHelper.parseParamString(props.location.search, [
        'page',
        'page_size',
      ]);

      if (!params['page_size']) {
        params['page_size'] = defaultPageSize;
      }

      if (!params['sort'] && defaultSort) {
        params['sort'] = defaultSort;
      }

      this.state = {
        alerts: [],
        error: null,
        inputText: '',
        itemCount: 0,
        items: [],
        loading: true,
        params,
        selectedFilter: null,
        unauthorized: false,
        unauthorizedDetail: null,
      };
    }

    componentDidMount() {
      this.setState({ alerts: (this.context as IAppContextType).alerts || [] });
      (this.context as IAppContextType).setAlerts([]);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (condition && !condition(this.context as any)) {
        this.setState({ loading: false, unauthorized: true });
      } else {
        this.query();
      }
    }

    componentWillUnmount() {
      this.objectPermissions.dispose();
    }

    componentDidUpdate(prevProps: RouteProps) {
      if (prevProps.sessionEpoch !== this.props.sessionEpoch) {
        // roles may have changed with the new session
        this.objectPermissions.reset();
      }
      this.readRowPermissions();

      // The same user signed in again after the session ended: read the list
      // once more. Dialogs and typed text stay; the latest-query guard drops
      // the answer of any read that is still on its way.
      if (
        prevProps.sessionEpoch !== this.props.sessionEpoch &&
        !this.state.unauthorized
      ) {
        this.query();
      }
    }

    render() {
      const {
        alerts,
        error,
        itemCount,
        items,
        loading,
        params,
        unauthorized,
        unauthorizedDetail,
      } = this.state;

      const localizedFilterConfig = filterConfig({ state: this.state }) || [];
      const knownFilters = localizedFilterConfig.map(({ id }) => id);
      const noData = items.length === 0 && !filterIsSet(params, knownFilters);

      const updateParams = (p) => this.updateParams(p, () => this.query());

      const niceNames = Object.fromEntries(
        localizedFilterConfig.map(({ id, title }) => [id, title]),
      );

      const niceValues = {};
      localizedFilterConfig
        .filter(({ options }) => options?.length)
        .forEach(({ id: filterId, options }) => {
          const obj = (niceValues[filterId] = {});
          options.forEach(({ id: optionId, title }) => {
            obj[optionId] = title;
          });
        });

      const actionContext = {
        addAlert: (alert) => this.addAlert(alert),
        hasObjectPermission: (permission, target) =>
          this.objectPermissions.holds(
            permission,
            target,
            (this.context as IAppContextType).hasPermission,
          ),
        hasPermission: (this.context as IAppContextType).hasPermission,
        listQuery: () => this.query(),
        navigate: this.props.navigate,
        query: () => this.query(),
        queueAlert: (this.context as IAppContextType).queueAlert,
        setState: (state) => this.setState(state),
        state: this.state,
      };

      const resetCompoundFilter = () =>
        this.setState({
          inputText: '',
          selectedFilter: localizedFilterConfig[0].id,
        });

      return (
        <>
          <AlertList
            alerts={alerts}
            closeAlert={(i) =>
              closeAlert(i, {
                alerts,
                setAlerts: (alerts) => this.setState({ alerts }),
              })
            }
          />
          <BaseHeader title={i18n._(title)} />
          {renderModals?.(actionContext)}
          {unauthorized ? (
            <InsufficientPermissions detail={unauthorizedDetail} />
          ) : error && !loading ? (
            <Main>
              <ListErrorState
                title={i18n._(errorTitle)}
                message={error}
                onRetry={() => this.query()}
              />
            </Main>
          ) : noData && !loading ? (
            <EmptyStateNoData
              button={this.emptyStateButton(actionContext)}
              description={i18n._(noDataDescription)}
              title={i18n._(noDataTitle)}
            />
          ) : (
            <Main>
              {loading ? (
                <LoadingSpinner />
              ) : (
                <section
                  className='pulp-section'
                  data-cy={`ListPage-${displayName}`}
                >
                  <div className='pulp-toolbar'>
                    <Toolbar>
                      <ToolbarContent>
                        <ToolbarGroup>
                          <ToolbarItem>
                            <CompoundFilter
                              inputText={this.state.inputText}
                              onChange={(inputText) => {
                                this.setState({ inputText });

                                if (typeaheadQuery) {
                                  typeaheadQuery({
                                    inputText,
                                    selectedFilter: this.state.selectedFilter,
                                    setState: (state) => this.setState(state),
                                  });
                                }
                              }}
                              updateParams={(p) => {
                                resetCompoundFilter();
                                updateParams(p);
                              }}
                              params={params}
                              filterConfig={localizedFilterConfig}
                              selectFilter={(selectedFilter) => {
                                this.setState({ selectedFilter });

                                if (typeaheadQuery) {
                                  typeaheadQuery({
                                    inputText: '',
                                    selectedFilter,
                                    setState: (state) => this.setState(state),
                                  });
                                }
                              }}
                            />
                          </ToolbarItem>
                          {headerActions
                            ?.filter((action) =>
                              action.isShown(null, actionContext),
                            )
                            .map((action) => (
                              <ToolbarItem key={action.title}>
                                {action.button(null, actionContext)}
                              </ToolbarItem>
                            ))}
                        </ToolbarGroup>
                      </ToolbarContent>
                    </Toolbar>

                    <PulpPagination
                      params={params}
                      updateParams={updateParams}
                      count={itemCount}
                      isTop
                    />
                  </div>
                  <div>
                    <AppliedFilters
                      updateParams={(p) => {
                        resetCompoundFilter();
                        updateParams(p);
                      }}
                      params={params}
                      ignoredParams={['page_size', 'page', 'sort', 'ordering']}
                      niceNames={niceNames}
                      niceValues={niceValues}
                    />
                  </div>
                  {loading ? (
                    <LoadingSpinner />
                  ) : (
                    this.renderTable(params, updateParams, actionContext)
                  )}

                  <PulpPagination
                    params={params}
                    updateParams={updateParams}
                    count={itemCount}
                  />
                </section>
              )}
            </Main>
          )}
        </>
      );
    }

    // The button of the empty state, or nothing when the action is hidden, so
    // the empty state never holds an empty actions area.
    private emptyStateButton(actionContext) {
      const button = noDataButton?.(null, actionContext);
      return button ? <>{button}</> : undefined;
    }

    private renderTable(params, updateParams, actionContext) {
      const { items } = this.state;

      if (!items.length) {
        return <EmptyStateFilter />;
      }

      const localizedSortHeaders = (sortHeaders || []).map(
        translateTitle,
      ) as LocalizedSortHeaders;

      // Whether any row shows an action decides if rows draw the trailing
      // actions cell at all; a list that declares no row actions decides
      // nothing here.
      const anyRowAction = listItemActions?.length
        ? items.some((item) =>
            listItemActions.some((action) =>
              action.isShown(item, actionContext),
            ),
          )
        : undefined;

      return (
        <Table aria-label={i18n._(title)}>
          <SortTable
            options={{ headers: localizedSortHeaders }}
            params={params}
            updateParams={updateParams}
          />
          <RowActionsColumn.Provider value={anyRowAction}>
            <Tbody>
              {items.map((item, i) => renderTableRow(item, i, actionContext))}
            </Tbody>
          </RowActionsColumn.Provider>
        </Table>
      );
    }

    // Reads the permissions the server lists for each row, in parallel and
    // once per row, when a row action depends on them: the global permissions
    // are known and the user lacks some row action's permission globally
    // (staff never do). A row counts as holding nothing until its read
    // answered.
    private readRowPermissions() {
      const { items, loading, unauthorized } = this.state;
      if (loading || unauthorized || !items.length) {
        return;
      }

      if (
        needsObjectPermissions(listItemActions, this.context as IAppContextType)
      ) {
        items.forEach((item) =>
          this.objectPermissions.read(
            (item as { pulp_href?: string })?.pulp_href,
          ),
        );
      }
    }

    private query() {
      const current = ++this.latestQuery;

      this.setState({ loading: true, error: null }, () => {
        query({ params: this.state.params })
          .then((result) => {
            if (current !== this.latestQuery) {
              return;
            }

            this.setState({
              items: result.data.results,
              itemCount: result.data.count,
              loading: false,
            });
          })
          .catch((e) => {
            if (current !== this.latestQuery) {
              return;
            }

            // The end of a session is no failure of the list: the sign-in
            // dialog explains it and the list reads again once the user has
            // signed in, so the page keeps its loading state until then.
            if (isSessionEnd(e)) {
              return;
            }

            // A refused read is not a failure to retry: the user is told they
            // may not view the list, with Pulp's own reason.
            if (requestErrorStatus(e) === 403) {
              this.setState({
                loading: false,
                items: [],
                itemCount: 0,
                unauthorized: true,
                unauthorizedDetail: requestErrorDetail(e),
              });
              return;
            }

            this.setState({
              loading: false,
              items: [],
              itemCount: 0,
              unauthorized: false,
              unauthorizedDetail: null,
              error: requestErrorDescription(e),
            });
          });
      });
    }

    private addAlert(alert: AlertType) {
      let alerts = this.state.alerts;
      if (alert.id) {
        alerts = alerts.filter(({ id }) => id !== alert.id);
      }

      this.setState({
        alerts: [...alerts, alert],
      });
    }

    private updateParams(params, callback = null) {
      ParamHelper.updateParams({
        params,
        navigate: (to) => this.props.navigate(to),
        setState: (state) => this.setState(state, callback),
      });
    }
  };

  return withRouter(klass);
};
