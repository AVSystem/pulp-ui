import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { Component } from 'react';
import { Link, Navigate } from 'react-router';
import { UserAPI, type UserType } from 'src/api';
import { AppContext, type IAppContextType } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  DeleteUserModal,
  InsufficientPermissions,
  LoadingPage,
  NotFound,
  UserFormPage,
  closeAlert,
} from 'src/components';
import { Paths, formatPath } from 'src/paths';
import {
  type ErrorMessagesType,
  type RouteProps,
  withRouter,
} from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

interface IState {
  alerts: AlertType[];
  errorMessages: ErrorMessagesType;
  notFound: boolean;
  redirect?: string;
  showDeleteModal: boolean;
  unauthorized: boolean;
  // the reason Pulp gave for refusing the read, when it gave one
  unauthorizedDetail: string | null;
  userDetail: UserType;
}

class UserDetail extends Component<RouteProps, IState> {
  static contextType = AppContext;

  constructor(props) {
    super(props);

    this.state = {
      alerts: [],
      errorMessages: {},
      notFound: false,
      showDeleteModal: false,
      unauthorized: false,
      unauthorizedDetail: null,
      userDetail: undefined,
    };
  }

  componentDidMount() {
    this.queryUser();
  }

  componentDidUpdate(prevProps: RouteProps) {
    // The same user signed in again: read the user again, keeping what is on
    // screen until the answer arrives.
    if (
      prevProps.sessionEpoch !== this.props.sessionEpoch &&
      !this.state.unauthorized
    ) {
      this.queryUser();
    }
  }

  private queryUser() {
    UserAPI.get(this.props.routeParams.user_id)
      .then((result) => this.setState({ userDetail: result.data }))
      .catch((e) => {
        // The session ended: the sign-in dialog explains it, and the page
        // keeps its spinner or its content until it reads again.
        if (isSessionEnd(e)) {
          return;
        }
        // A refused read is not a missing user: the user is told they may
        // not view it, with Pulp's own reason.
        if (requestErrorStatus(e) === 403) {
          this.setState({
            unauthorized: true,
            unauthorizedDetail: requestErrorDetail(e),
          });
        } else {
          this.setState({ notFound: true });
        }
      });
  }

  render() {
    if (this.state.redirect) {
      return <Navigate to={this.state.redirect} />;
    }

    const {
      alerts,
      errorMessages,
      notFound,
      showDeleteModal,
      unauthorized,
      unauthorizedDetail,
      userDetail,
    } = this.state;

    const { hasPermission } = this.context as IAppContextType;

    if (unauthorized) {
      return (
        <>
          <BaseHeader title={t`Insufficient permissions`} />
          <InsufficientPermissions detail={unauthorizedDetail} />
        </>
      );
    }

    if (notFound) {
      return <NotFound />;
    }

    if (!userDetail) {
      return <LoadingPage />;
    }

    const breadcrumbs = [
      { url: formatPath(Paths.core.user.list), name: t`Users` },
      { name: userDetail.username },
    ];
    const title = t`User details`;

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
        <DeleteUserModal
          isOpen={showDeleteModal}
          closeModal={this.closeModal}
          user={userDetail}
          addAlert={(text, variant, description = undefined) =>
            this.setState({
              alerts: alerts.concat([
                { title: text, variant: variant, description: description },
              ]),
            })
          }
        />
        <UserFormPage
          user={userDetail}
          breadcrumbs={breadcrumbs}
          title={title}
          errorMessages={errorMessages}
          updateUser={(user) => this.setState({ userDetail: user })}
          isReadonly
          extraControls={
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              {hasPermission('auth.change_user') ? (
                <div>
                  <Link
                    to={formatPath(Paths.core.user.edit, {
                      user_id: userDetail.id,
                    })}
                  >
                    <Button>{t`Edit`}</Button>
                  </Link>
                </div>
              ) : null}
              {hasPermission('auth.delete_user') ? (
                <div style={{ marginLeft: '8px' }}>
                  <Button
                    variant='secondary'
                    onClick={() => this.setState({ showDeleteModal: true })}
                  >
                    {t`Delete`}
                  </Button>
                </div>
              ) : null}
            </div>
          }
        />
      </>
    );
  }

  private closeModal = (didDelete) =>
    this.setState(
      {
        showDeleteModal: false,
      },
      () => {
        if (didDelete) {
          this.setState({ redirect: formatPath(Paths.core.user.list) });
        }
      },
    );
}

export default withRouter(UserDetail);
