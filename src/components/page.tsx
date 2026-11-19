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
  LoadingSpinner,
  Main,
  NotFound,
  closeAlert,
} from 'src/components';
import { type RouteProps, withRouter } from 'src/utilities';
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
  // why the last load failed; null while the object is loading or loaded
  error: ReactNode;
  item: T;
  loading: boolean;
  unauthorized: boolean;
  // the reason Pulp gave for refusing the read, when it gave one
  unauthorizedDetail: string | null;
}

// states:
// loading - initial state, only Main + spinner, header and alerts
// unauthorized - only InsufficientPermissions, header (no actions) and alerts:
//   the read was refused (403) or the screen's condition does not hold
// error - the load failed, header and ListErrorState with a retry; render is
//   never called, so a form for an existing object is not shown without it
// missing - the route names an object and the finished read gave none: the
//   not-found page and the alerts; render is never called, so the page cannot
//   turn into the form of a new object
// (data) - renders detail, or the form of a new object when the route has no name
//
// A load that fails because the session ended changes nothing: the page keeps
// its loading state or its content, the sign-in dialog explains the failure
// and the page reads again once the same user has signed in.

// The permission a page's form needs: the permission of the object when the
// page shows one (objectLevel: it may be held on that object alone), the add
// permission when the page is for a new object. A page with a form permission
// shows its form only when it is held; presentation only, the server decides
// every save.
export interface FormPermission {
  objectLevel: boolean;
  permission: string;
}

interface PageParams<T> {
  breadcrumbs: ({ name }) => { url?: string; name: string }[];
  condition?: (context) => boolean;
  displayName: string;
  errorTitle: MessageDescriptor;
  formPermission?: (item: T | null) => FormPermission | null;
  headerActions?: ActionType[];
  listUrl: string;
  query: ({ name }) => Promise<T>;
  title: ({ name }) => string;
  transformParams: (routeParams) => Record<string, string>;
  render: (item, actionContext) => ReactNode;
}

export const Page = function <
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
  // (item | null) => the permission the form needs, or null for none; the
  // form is replaced by the loading state until that is known and by the
  // insufficient permissions page when it is not held
  formPermission,
  // displayed after filters
  headerActions,
  // formatPath result to navigate to - to get to the list screen
  listUrl,
  // () => Promise<T>
  query,
  title,
  transformParams,
  render,
}: PageParams<T>) {
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

      this.state = {
        alerts: [],
        error: null,
        item: null,
        loading: true,
        unauthorized: false,
        unauthorizedDetail: null,
      };
    }

    componentDidMount() {
      this.mounted = true;
      this.setState({ alerts: (this.context as IAppContextType).alerts || [] });
      (this.context as IAppContextType).setAlerts([]);

      // condition check after query, for object permissions
      this.query()
        .then((item) => {
          const actionContext = {
            ...(this.context as IAppContextType),
            hasObjectPermission: (permission) =>
              item?.my_permissions?.includes?.(permission),
          };

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (condition && !condition(actionContext as any)) {
            this.setState({ loading: false, unauthorized: true });
          }
        })
        // the failure is already shown as the error state
        .catch(() => undefined);
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

      if (
        prevProps.sessionEpoch === this.props.sessionEpoch ||
        this.state.unauthorized ||
        !transformParams(this.props.routeParams)?.name
      ) {
        return;
      }

      // The same user signed in again after the session ended. A page that
      // shows its object reads it again in the background, so a form keeps
      // what the user typed (the edited copy lives in the page state, which
      // this read does not touch). A page that is still loading or shows an
      // error state reads again like a first visit.
      const { error, item, loading } = this.state;
      this.query({ quiet: !!item && !loading && !error }).catch(
        // the failure is shown as the error state or as an alert
        () => undefined,
      );
    }

    render() {
      const { routeParams } = this.props;
      const { alerts, error, item, loading, unauthorized, unauthorizedDetail } =
        this.state;

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
        // a failed reload is shown as the error state, so callers that do not
        // wait for the result never see a rejection
        query: () => this.query().catch(() => undefined),
        queueAlert: (this.context as IAppContextType).queueAlert,
        setState: (s) => this.setState(s),
        state: this.state,
      };

      const name = item?.name || transformParams(routeParams)?.name || null;

      // An edit address names an existing object. When the finished read gave
      // none (it does not exist, or the account cannot see it) the page says
      // so and never turns into the form of a new object, which would create
      // an object from a mistyped address. Render is not called, so no save
      // action of the page is reachable either.
      const missing =
        !!transformParams(routeParams)?.name &&
        !loading &&
        !error &&
        !unauthorized &&
        !item;

      if (missing) {
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

      const form = this.formState();

      // Only the actions the user may use are drawn; with none, no container.
      const shownActions = (headerActions ?? []).filter((action) =>
        action.isShown(item, actionContext),
      );

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
            title={title({ name })}
            breadcrumbs={
              <Breadcrumbs
                links={breadcrumbs({
                  name,
                })}
              />
            }
            pageControls={
              unauthorized ||
              form === 'refused' ||
              !shownActions.length ? null : (
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
          />
          {renderModals?.(actionContext)}
          {unauthorized ? (
            <InsufficientPermissions detail={unauthorizedDetail} />
          ) : !loading && !error && form === 'refused' ? (
            <InsufficientPermissions />
          ) : (
            <Main>
              {loading || form === 'unknown' ? (
                <LoadingSpinner />
              ) : error ? (
                <ListErrorState
                  title={i18n._(errorTitle)}
                  message={error}
                  onRetry={() => {
                    // a failure is shown as the error state again
                    this.query().catch(() => undefined);
                  }}
                />
              ) : (
                <section
                  className='pulp-section'
                  data-cy={`Page-${displayName}`}
                >
                  {render(item, actionContext)}
                </section>
              )}
            </Main>
          )}
        </>
      );
    }

    // Whether the page's form may be shown, once the object is loaded:
    // 'unknown' while the permissions it depends on are being read, 'allowed'
    // or 'refused' after. A page without a form permission is always allowed.
    // A route that names an object has no form permission until the object is
    // there: the add permission is for a route without a name only.
    private formState(): 'allowed' | 'refused' | 'unknown' {
      const named = !!transformParams(this.props.routeParams)?.name;
      const required =
        named && !this.state.item ? null : formPermission?.(this.state.item);
      if (!required) {
        return 'allowed';
      }

      const { hasPermission, permissionsReady } = this
        .context as IAppContextType;
      if (!permissionsReady) {
        return 'unknown';
      }

      const { item } = this.state;
      if (
        this.objectPermissions.holds(required.permission, item, hasPermission)
      ) {
        return 'allowed';
      }

      // Only the object's own permissions can still grant it; until they are
      // known the form stays hidden, and so it does when their read failed.
      if (
        required.objectLevel &&
        item &&
        !this.objectPermissions.knows(item) &&
        !this.objectPermissions.failed(item)
      ) {
        return 'unknown';
      }

      return 'refused';
    }

    // quiet: the object is shown already; read it again without a loading
    // state and keep the page as it is when the read fails
    private query({ quiet = false } = {}): Promise<T> {
      const { name } = transformParams(this.props.routeParams);

      if (!name) {
        this.latestQuery += 1;
        this.setState({ loading: false, error: null });
        return Promise.resolve(null);
      }

      const current = ++this.latestQuery;

      return new Promise((resolve, reject) => {
        const read = () =>
          query({ name })
            .then((item) => {
              if (current === this.latestQuery) {
                this.setState({
                  error: null,
                  item,
                  loading: false,
                });
              }
              resolve(item);
            })
            .catch((e) => {
              if (current === this.latestQuery && !isSessionEnd(e)) {
                if (!quiet && requestErrorStatus(e) === 403) {
                  // A refused read is not a failure to retry: the user is
                  // told they may not view the page, with Pulp's own reason.
                  this.setState({
                    loading: false,
                    item: null,
                    error: null,
                    unauthorized: true,
                    unauthorizedDetail: requestErrorDetail(e),
                  });
                } else if (quiet) {
                  this.addAlert({
                    variant: 'danger',
                    title: i18n._(errorTitle),
                    description: requestErrorDescription(e),
                  });
                } else {
                  this.setState({
                    loading: false,
                    item: null,
                    error: requestErrorDescription(e),
                  });
                }
              }
              reject(e);
            });

        if (quiet) {
          read();
        } else {
          this.setState({ loading: true, error: null }, read);
        }
      });
    }

    // Reads the permissions the server lists for the object, once, when a
    // header action or the form depends on them: the global permissions are known, the
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

      const required = formPermission?.(item);
      const { hasPermission, permissionsReady } = this
        .context as IAppContextType;
      const formNeedsObject =
        !!required &&
        required.objectLevel &&
        !!permissionsReady &&
        !hasPermission(required.permission);

      if (
        formNeedsObject ||
        needsObjectPermissions(headerActions, this.context as IAppContextType)
      ) {
        this.objectPermissions.read(item.pulp_href);
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
  };

  return withRouter(klass);
};
