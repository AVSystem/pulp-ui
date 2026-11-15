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
  EmptyStateUnauthorized,
  LoadingSpinner,
  Main,
  closeAlert,
} from 'src/components';
import { type RouteProps, withRouter } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from '../utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IState<T> {
  alerts: AlertType[];
  // why the last load failed; null while the object is loading or loaded
  error: ReactNode;
  item: T;
  loading: boolean;
  unauthorized: boolean;
}

// states:
// loading - initial state, only Main + spinner, header and alerts
// unauthorized - only EmptyStateUnauthorized, header and alerts
// error - the load failed, header and ListErrorState with a retry; render is
//   never called, so a form for an existing object is not shown without it
// (data) - renders detail, or the form of a new object when the route has no name
//
// A load that fails because the session ended changes nothing: the page keeps
// its loading state or its content, the sign-in dialog explains the failure
// and the page reads again once the same user has signed in.

interface PageParams<T> {
  breadcrumbs: ({ name }) => { url?: string; name: string }[];
  condition?: (context) => boolean;
  displayName: string;
  errorTitle: MessageDescriptor;
  headerActions?: ActionType[];
  listUrl: string;
  query: ({ name }) => Promise<T>;
  title: ({ name }) => string;
  transformParams: (routeParams) => Record<string, string>;
  render: (item, actionContext) => ReactNode;
}

export const Page = function <
  T extends { name: string; my_permissions?: string[] },
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

    constructor(props) {
      super(props);

      this.state = {
        alerts: [],
        error: null,
        item: null,
        loading: true,
        unauthorized: false,
      };
    }

    componentDidMount() {
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

    componentDidUpdate(prevProps: RouteProps) {
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
      const { alerts, error, item, loading, unauthorized } = this.state;

      const actionContext = {
        addAlert: (alert) => this.addAlert(alert),
        hasObjectPermission: (permission) =>
          item?.my_permissions?.includes?.(permission),
        hasPermission: (this.context as IAppContextType).hasPermission,
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
              <div className='pulp-toolbar'>
                <Toolbar>
                  <ToolbarContent>
                    <ToolbarGroup>
                      {headerActions?.length &&
                        headerActions.map((action) => (
                          <ToolbarItem key={action.title}>
                            {action.button(item, actionContext)}
                          </ToolbarItem>
                        ))}
                    </ToolbarGroup>
                  </ToolbarContent>
                </Toolbar>
              </div>
            }
          />
          {renderModals?.(actionContext)}
          {unauthorized ? (
            <EmptyStateUnauthorized />
          ) : (
            <Main>
              {loading ? (
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
                if (quiet) {
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
