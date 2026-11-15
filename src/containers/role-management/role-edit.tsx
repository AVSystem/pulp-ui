import { t } from '@lingui/core/macro';
import { Component } from 'react';
import { Navigate } from 'react-router';
import { RoleAPI, type RoleType } from 'src/api';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  InsufficientPermissions,
  LoadingPage,
  Main,
  NotFound,
  RoleForm,
  RoleHeader,
  closeAlert,
} from 'src/components';
import { Paths, formatPath } from 'src/paths';
import {
  type ErrorMessagesType,
  type RouteProps,
  mapNetworkErrors,
  parsePulpIDFromURL,
  translateLockedRole,
  validateInput,
  withRouter,
} from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

interface IState {
  alerts: AlertType[];
  description: string;
  editPermissions: boolean;
  errorMessages: Record<string, string>;
  inputText: string;
  itemCount: number;
  name: string;
  nameError: boolean;
  notFound: boolean;
  options: { id: number; name: string }[];
  originalPermissions: string[];
  params: {
    id: string;
  };
  permissions: string[];
  redirect?: string;
  role: RoleType;
  roleError: ErrorMessagesType;
  saving: boolean;
  selected: { id: number; name: string }[];
  showDeleteModal: boolean;
  unauthorized: boolean;
  // the reason Pulp gave for refusing the read, when it gave one
  unauthorizedDetail: string | null;
}

class EditRole extends Component<RouteProps, IState> {
  // true once the user typed a description: a later read never replaces it
  descriptionTouched = false;

  constructor(props) {
    super(props);

    const id = this.props.routeParams.role;

    this.state = {
      alerts: [],
      description: null,
      editPermissions: false,
      errorMessages: {},
      inputText: '',
      itemCount: 0,
      name: null,
      nameError: false,
      notFound: false,
      options: undefined,
      originalPermissions: [],
      params: {
        id,
      },
      permissions: [],
      role: null,
      roleError: null,
      saving: false,
      selected: [],
      showDeleteModal: false,
      unauthorized: false,
      unauthorizedDetail: null,
    };
  }

  componentDidMount() {
    this.setState({ editPermissions: true });
    this.queryRole();
  }

  componentDidUpdate(prevProps: RouteProps) {
    // The same user signed in again: read the role again. An untouched form
    // shows the fresh role, a changed description stays as typed.
    if (prevProps.sessionEpoch !== this.props.sessionEpoch) {
      this.queryRole();
    }
  }

  private queryRole() {
    RoleAPI.get(this.state.params.id)
      .then((result) => {
        this.setState((previous) => ({
          role: result.data,
          description: this.descriptionTouched
            ? previous.description
            : result.data.description,
          name: result.data.name,
          originalPermissions: result.data.permissions,
        }));
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it, and the page
        // keeps its spinner or its form until it reads again.
        if (isSessionEnd(e)) {
          return;
        }
        // A refused read is not a failure to retry: the user is told they
        // may not view the role, with Pulp's own reason.
        if (requestErrorStatus(e) === 403) {
          this.setState({
            unauthorized: true,
            unauthorizedDetail: requestErrorDetail(e),
          });
          return;
        }
        // Until the role was read its name is unknown, so the title says
        // only that the role could not be shown.
        const roleName = this.state.role?.name;
        this.setState({ notFound: true });
        this.addAlert(
          roleName
            ? t`Role "${roleName}" could not be displayed.`
            : t`Role could not be displayed.`,
          'danger',
          requestErrorDescription(e),
        );
      });
  }

  render() {
    if (this.state.redirect) {
      return <Navigate to={this.state.redirect} />;
    }

    const {
      alerts,
      description,
      editPermissions,
      errorMessages,
      name,
      notFound,
      role,
      saving,
      unauthorized,
      unauthorizedDetail,
    } = this.state;

    if (unauthorized) {
      return (
        <>
          <BaseHeader title={t`Insufficient permissions`} />
          <InsufficientPermissions detail={unauthorizedDetail} />
        </>
      );
    }

    if (!role && alerts && alerts.length) {
      return (
        <AlertList
          alerts={alerts}
          closeAlert={(i) =>
            closeAlert(i, {
              alerts,
              setAlerts: (alerts) => this.setState({ alerts }),
            })
          }
        />
      );
    }

    if (notFound) {
      return <NotFound />;
    }

    if (!role) {
      return <LoadingPage />;
    }

    const breadcrumbs = [
      { url: formatPath(Paths.core.role.list), name: t`Roles` },
      { name: role.name },
    ];

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
        <RoleHeader
          title={editPermissions ? t`Edit role permissions` : role.name}
          subTitle={translateLockedRole(role.name, role.description)}
          breadcrumbs={breadcrumbs}
        />
        <Main>
          <section className='pulp-section'>
            <RoleForm
              {...this.state}
              name={name}
              nameDisabled
              description={description}
              descriptionHelperText={errorMessages['description']}
              descriptionValidated={
                errorMessages['description'] ? 'error' : null
              }
              onDescriptionChange={(value) => {
                this.descriptionTouched = true;
                this.setState({ description: value }, () => {
                  const errors = validateInput(
                    value,
                    'description',
                    this.state.errorMessages,
                  );
                  this.setState({ errorMessages: errors });
                });
              }}
              saving={saving}
              saveRole={this.editRole}
              isSavingDisabled={
                'description' in errorMessages || 'name' in errorMessages
              }
              cancelRole={this.cancelRole}
            />
          </section>
        </Main>
      </>
    );
  }

  private cancelRole = () => {
    this.setState({
      errorMessages: {},
      redirect: formatPath(Paths.core.role.list),
    });
  };

  private addAlert(title, variant, description?) {
    this.setState({
      alerts: [
        ...this.state.alerts,
        {
          description,
          title,
          variant,
        },
      ],
    });
  }

  private editRole = (permissions) => {
    this.setState({ saving: true }, () => {
      const { pulp_href } = this.state.role;
      const roleID = parsePulpIDFromURL(pulp_href) + '/';
      const { name, description } = this.state;

      RoleAPI.updatePermissions(roleID, { name, description, permissions })
        .then(() =>
          this.setState({ redirect: formatPath(Paths.core.role.list) }),
        )
        .catch((err) => {
          // The session ended: nothing was saved and nothing is repeated; the
          // form stays as typed.
          if (isSessionEnd(err)) {
            this.setState({ saving: false });
            return;
          }
          if (requestErrorStatus(err) === 400) {
            const errors = mapNetworkErrors(err);

            this.setState({ saving: false, errorMessages: errors });
          } else {
            this.setState({
              errorMessages: {},
              alerts: this.state.alerts.concat({
                variant: 'danger',
                title: t`Changes to role "${name}" could not be saved.`,
                description: requestErrorDescription(err),
              }),
              saving: false,
            });
          }
        });
    });
  };

  private toError(validated: boolean) {
    return validated ? 'default' : 'error';
  }
}

export default withRouter(EditRole);
