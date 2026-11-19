import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  DeleteUserModal,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  PermissionsFailed,
  UserFormPage,
  closeAlert,
} from 'src/components';
import { userToForm } from 'src/entities/core/user/form';
import { userHref } from 'src/entities/core/user/href';
import { useUser } from 'src/entities/core/user/queries';
import { Paths, formatPath } from 'src/paths';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

// The address holds the id of one user. Another user is another screen: what
// the one left behind showed, its alerts and its open dialog go with it.
const UserDetail = () => {
  const { user_id: urlId } = useParams();

  return <UserDetailScreen key={urlId} urlId={urlId} />;
};

const UserDetailScreen = ({ urlId }: { urlId: string }) => {
  const { hasPermission, permissionsFailed } = useAppContext();

  // The id of the address becomes an address of the API only here; an id that
  // is not one has no user and asks for nothing.
  const href = userHref(urlId);
  const query = useUser(href);
  const userDetail = query.data;
  const form = useMemo(
    () => (userDetail ? userToForm(userDetail) : undefined),
    [userDetail],
  );

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [redirect, setRedirect] = useState<string>();

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // The user on screen is never replaced by the failure of a later read: it
  // stays, and the failure is reported next to it, once.
  const alertedFailure = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded;
  useEffect(() => {
    if (rereadFailed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: t`User could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  // The permissions could not be read: no action is offered on a guess.
  if (permissionsFailed) {
    return <PermissionsFailed title={t`User details`} />;
  }

  if (href === null || (!form && status === 404)) {
    return <NotFound />;
  }

  // A refused read is not a missing user: the user is told they may not view
  // it, with Pulp's own reason.
  if (!form && status === 403) {
    return (
      <>
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!form && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        <BaseHeader title={t`User details`} />
        <Main>
          <ListErrorState
            title={t`User could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!form) {
    return <LoadingPage />;
  }

  // what the delete dialog needs of the user: its address and its name
  const deleteTarget = { pulp_href: href, username: form.username };

  const breadcrumbs = [
    { url: formatPath(Paths.core.user.list), name: t`Users` },
    { name: form.username },
  ];
  const title = t`User details`;

  return (
    <>
      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
      <DeleteUserModal
        isOpen={showDeleteModal}
        closeModal={(didDelete) => {
          setShowDeleteModal(false);
          if (didDelete) {
            setRedirect(formatPath(Paths.core.user.list));
          }
        }}
        user={deleteTarget}
        addAlert={(text, variant, description = undefined) =>
          setAlerts((current) => [
            ...current,
            { title: text, variant, description },
          ])
        }
      />
      <UserFormPage
        user={form}
        breadcrumbs={breadcrumbs}
        title={title}
        errorMessages={{}}
        updateUser={() => undefined}
        isReadonly
        extraControls={
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {hasPermission('auth.change_user') ? (
              <div>
                <Link to={formatPath(Paths.core.user.edit, { user_id: urlId })}>
                  <Button>{t`Edit`}</Button>
                </Link>
              </div>
            ) : null}
            {hasPermission('auth.delete_user') ? (
              <div style={{ marginLeft: '8px' }}>
                <Button
                  variant='secondary'
                  onClick={() => setShowDeleteModal(true)}
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
};

export default UserDetail;
