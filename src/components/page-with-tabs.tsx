import { type MessageDescriptor, i18n } from '@lingui/core';
import {
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Component, type ReactNode } from 'react';
import { type ActionType } from 'src/actions';
import { AppContext, type IAppContextType } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  InsufficientPermissions,
  LinkTabs,
  type LinkTabsProps,
  LoadingSpinner,
  Main,
  NotFound,
  closeAlert,
} from 'src/components';
import { ParamHelper, type RouteProps, withRouter } from 'src/utilities';
import {
  ObjectPermissions,
  needsObjectPermissions,
} from '../utilities/my-permissions';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from '../utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IState<T> {
  alerts: AlertType[];
  // why the last load failed, with its HTTP status when it had one; null
  // while the object is loading or loaded
  error: { description: ReactNode; status: number | null } | null;
  item: T;
  loading: boolean;
  params: {
    tab?: string;
  };
  unauthorized: boolean;
  // the reason Pulp gave for refusing the read, when it gave one
  unauthorizedDetail: string | null;
}

// states:
// loading - initial state, only Main + spinner, header and alerts
// unauthorized - only InsufficientPermissions, header (no actions) and alerts:
//   the read was refused (403) or the screen's condition does not hold
// notFound - the load answered 404, NotFound
// error - any other failed load, header and ListErrorState with a retry
// (data) - renders detail
//
// A load that fails because the session ended changes nothing: the page keeps
// its loading state or its content, the sign-in dialog explains the failure
// and the page reads again once the same user has signed in.

interface PageWithTabsParams<T> {
  breadcrumbs: ({ name, tab, params }) => { url?: string; name: string }[];
  condition?: (context) => boolean;
  displayName: string;
  errorTitle: MessageDescriptor;
  headerActions?: ActionType[];
  headerDetails?: (item) => ReactNode;
  listUrl: string;
  query: ({ name }) => Promise<T>;
  renderTab: (tab, item, actionContext) => ReactNode;
  tabs: (tab, name) => LinkTabsProps['tabs'];
}

export const PageWithTabs = function <
  T extends { name: string; my_permissions?: string[]; pulp_href?: string },
>({
  // ({ name }) => [{ url?, name }]
  breadcrumbs,
  // receives the app context (user, hasPermission, ...) => bool
  condition,
  // component name for debugging
  displayName,
  // alert on query failure
  errorTitle,
  // displayed after filters
  headerActions,
  // under title
  headerDetails,
  // formatPath result to navigate to - to get to the list screen
  listUrl,
  // () => Promise<T>
  query,
  renderTab,
  tabs,
}: PageWithTabsParams<T>) {
  const renderModals = (actionContext) => (
    <>
      {headerActions?.length
        ? headerActions.map((action) => action?.modal?.(actionContext))
        : null}
    </>
  );

  const klass = class extends Component<RouteProps, IState<T>> {
    static displayName = displayName;
    static contextType = AppContext;

    // number of the latest load; the answer of an older load is ignored
    private latestQuery = 0;

    // whether the page is on screen; an action that outlives the page asks
    private mounted = false;

    // what the server lists for the page's object, read when a header action
    // can only be decided by it
    private objectPermissions = new ObjectPermissions(() => this.forceUpdate());

    constructor(props) {
      super(props);

      const params = ParamHelper.parseParamString(props.location.search);

      if (!params['tab']) {
        params['tab'] = 'details';
      }

      this.state = {
        alerts: [],
        error: null,
        item: null,
        loading: true,
        unauthorized: false,
        unauthorizedDetail: null,
        params,
      };
    }

    componentDidMount() {
      this.mounted = true;
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
      this.mounted = false;
      this.objectPermissions.dispose();
    }

    componentDidUpdate(prevProps: RouteProps) {
      if (prevProps.sessionEpoch !== this.props.sessionEpoch) {
        // roles may have changed with the new session
        this.objectPermissions.reset();
      }
      this.readObjectPermissions();

      if (prevProps.location !== this.props.location) {
        const params = ParamHelper.parseParamString(this.props.location.search);
        this.setState({ params: { tab: 'details', ...params } });
      }

      // The same user signed in again after the session ended. A page that
      // shows its object reads it again in the background, so the open tab
      // keeps what it holds. A page that is still loading, or shows an error
      // or not-found state, reads again like a first visit.
      if (
        prevProps.sessionEpoch !== this.props.sessionEpoch &&
        !this.state.unauthorized
      ) {
        const { error, item, loading } = this.state;
        this.query({ quiet: !!item && !loading && !error });
      }
    }

    render() {
      const { routeParams } = this.props;
      const {
        alerts,
        error,
        item,
        loading,
        params,
        unauthorized,
        unauthorizedDetail,
      } = this.state;

      const actionContext = {
        addAlert: (alert) => this.addAlert(alert),
        hasObjectPermission: (permission, target = item) =>
          this.objectPermissions.holds(
            permission,
            target,
            (this.context as IAppContextType).hasPermission,
          ),
        hasPermission: (this.context as IAppContextType).hasPermission,
        isMounted: () => this.mounted,
        listQuery: () => this.props.navigate(listUrl),
        navigate: this.props.navigate,
        query: () => this.query(),
        queueAlert: (this.context as IAppContextType).queueAlert,
        setState: (state) => this.setState(state),
        state: this.state,
      };

      const name = item?.name || routeParams.name;
      const tab = params.tab || 'details';

      // Only the actions the user may use are drawn; with none, no container.
      // The actions act on the page's object and some look inside it, so none
      // is asked about before the object has been read.
      const shownActions = item
        ? (headerActions ?? []).filter((action) =>
            action.isShown(item, actionContext),
          )
        : [];

      if (!loading && !unauthorized && !item && error && error.status !== 404) {
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
            <BaseHeader
              title={name}
              breadcrumbs={
                <Breadcrumbs links={breadcrumbs({ name, tab, params })} />
              }
            />
            <Main>
              <ListErrorState
                title={i18n._(errorTitle)}
                message={error.description}
                onRetry={() => this.query()}
              />
            </Main>
          </>
        );
      }

      if (!loading && !unauthorized && !item) {
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
            <NotFound />
          </>
        );
      }

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
          <BaseHeader
            title={name}
            breadcrumbs={
              <Breadcrumbs
                links={breadcrumbs({
                  name,
                  tab,
                  params,
                })}
              />
            }
            pageControls={
              loading || unauthorized || !shownActions.length ? null : (
                <div className='pulp-toolbar'>
                  <Toolbar>
                    <ToolbarContent>
                      <ToolbarGroup>
                        {shownActions.map((action) => (
                          <ToolbarItem key={action.title}>
                            {action.button(item, actionContext)}
                          </ToolbarItem>
                        ))}
                      </ToolbarGroup>
                    </ToolbarContent>
                  </Toolbar>
                </div>
              )
            }
          >
            {headerDetails?.(item)}
            <div className='pulp-tab-link-container'>
              <div className='tabs'>
                <LinkTabs tabs={tabs(tab, name)} />
              </div>
            </div>
          </BaseHeader>
          {renderModals?.(actionContext)}
          {unauthorized ? (
            <InsufficientPermissions detail={unauthorizedDetail} />
          ) : (
            <Main>
              {loading ? (
                <LoadingSpinner />
              ) : (
                <section
                  className='pulp-section'
                  data-cy={`PageWithTabs-${displayName}-${tab}`}
                >
                  {this.renderTab(tab, actionContext)}
                </section>
              )}
            </Main>
          )}
        </>
      );
    }

    // Reads the permissions the server lists for the object, once, when a
    // header action depends on them: the global permissions are known, the
    // user lacks the action's permission globally (staff never do) and the
    // object does not carry the list itself.
    private readObjectPermissions() {
      const { item, loading, unauthorized } = this.state;
      if (
        !item ||
        loading ||
        unauthorized ||
        Array.isArray(item.my_permissions)
      ) {
        return;
      }

      if (
        needsObjectPermissions(headerActions, this.context as IAppContextType)
      ) {
        this.objectPermissions.read(item.pulp_href);
      }
    }

    private renderTab(tab, actionContext) {
      const { item } = this.state;
      if (!item) {
        return null;
      }

      return renderTab(tab, item, actionContext);
    }

    // quiet: the object is shown already; read it again without a loading
    // state and keep the page as it is when the read fails
    private query({ quiet = false } = {}) {
      const { name } = this.props.routeParams;
      const current = ++this.latestQuery;

      const read = () =>
        query({ name })
          .then((item) => {
            if (current !== this.latestQuery) {
              return;
            }

            this.setState({
              error: null,
              item,
              loading: false,
            });
          })
          .catch((e) => {
            if (current !== this.latestQuery || isSessionEnd(e)) {
              return;
            }

            if (quiet) {
              this.addAlert({
                variant: 'danger',
                title: i18n._(errorTitle),
                description: requestErrorDescription(e),
              });
              return;
            }

            // A refused read is not a failure to retry: the user is told they
            // may not view the page, with Pulp's own reason.
            if (requestErrorStatus(e) === 403) {
              this.setState({
                loading: false,
                item: null,
                error: null,
                unauthorized: true,
                unauthorizedDetail: requestErrorDetail(e),
              });
              return;
            }

            this.setState({
              loading: false,
              item: null,
              error: {
                description: requestErrorDescription(e),
                status: requestErrorStatus(e),
              },
            });
          });

      if (quiet) {
        read();
      } else {
        this.setState({ loading: true, error: null }, read);
      }
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
