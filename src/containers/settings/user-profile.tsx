import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  PermissionsFailed,
  UserFormPage,
  closeAlert,
} from 'src/components';
import {
  type UserFormValues,
  userChanges,
  userToForm,
} from 'src/entities/core/user/form';
import {
  useOwnUser,
  useOwnUserHref,
  useUpdateUser,
} from 'src/entities/core/user/queries';
import { usePermissions } from 'src/permissions';
import { useUserContext } from 'src/user-context';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { userSaveErrors } from '../user-management/save-errors';

// The record is read by the address the session names: Pulp lets every user
// read their own record, while the list of users is open only to those who may
// view users.
function UserProfile() {
  const ownHref = useOwnUserHref();
  const query = useOwnUser();
  const updateUser = useUpdateUser();
  const { permissionsFailed, permissionsError } = useAppContext();
  const {
    user: sessionUser,
    setUser: setSessionUser,
    endSession,
    status: sessionStatus,
  } = useUserContext();
  // Pulp lets every user read their own record but changes a user record only
  // for those who may change users, so the Edit control is offered to them
  // alone. Until the permissions are known it is not offered.
  const { hasPermission } = usePermissions();

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [inEditMode, setInEditMode] = useState<boolean>(false);

  // What the last read holds, as the form shows it.
  const read = useMemo(
    () => (query.data ? userToForm(query.data) : undefined),
    [query.data],
  );
  // Once the form was changed it is the user's: a later read never replaces
  // what was typed. `shown` is the form as it was before the first change, so
  // a save sends only what was changed.
  const [edit, setEdit] = useState<{
    form: UserFormValues;
    shown: UserFormValues;
  } | null>(null);
  const form = edit?.form ?? read;

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A form on screen is never replaced by the failure of a later read: what
  // was typed stays, and the failure is reported next to it, once.
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

  const saveUser = () => {
    if (updateUser.isPending || !form || !read?.pulp_href) {
      return;
    }
    const username = sessionUser?.username;

    // The promise, not a callback of the screen: the outcome of a save is
    // acted on even when the screen has gone by then.
    updateUser
      .mutateAsync({
        href: read.pulp_href,
        changes: userChanges(edit?.shown ?? read, form),
      })
      .then(() => {
        // What was saved is what the record holds now, so Cancel returns to it
        // and not to the values from before the save.
        setEdit(null);
        setInEditMode(false);
        setErrorMessages({});
        setAlerts((current) => [
          ...current,
          {
            variant: 'success',
            title: t`Saved changes to user "${username}".`,
          },
        ]);

        if (form.password) {
          // The server ends every session of a user whose password changes, so
          // the next request would fail. The route guard sends the user to the
          // login page, which explains why.
          endSession('password-changed');
        } else if (username !== form.username) {
          // A rename keeps the session.
          setSessionUser({ ...sessionUser, username: form.username });
        }
      })
      .catch((error) => setErrorMessages(userSaveErrors(error)));
  };

  const title = t`My profile`;

  // A session that names no user address cannot lead to a record: say so
  // instead of waiting for a read that is never started.
  if (sessionStatus === 'authenticated' && ownHref === null) {
    return <NotFound />;
  }

  if (!form && status === 404) {
    return <NotFound />;
  }

  // A refused read is not a missing profile: the user is told they may not
  // view it, with Pulp's own reason.
  if (!form && status === 403) {
    return (
      <>
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  // The session ended: the sign-in dialog explains it, and the page keeps its
  // spinner until it reads again.
  if (!form && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        <BaseHeader title={title} />
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

  // The permissions could not be read: nothing is offered on a guess. A form
  // the user has changed stays, as a later read never replaces what was typed,
  // and so does a profile whose permission read stopped only because the
  // session ended: the sign-in dialog explains that.
  if (permissionsFailed && !isSessionEnd(permissionsError) && !edit) {
    return <PermissionsFailed title={title} />;
  }

  if (!form) {
    return <LoadingPage />;
  }

  const breadcrumbs = [{ name: t`Settings` }, { name: t`My profile` }];
  const extraControls = !inEditMode && hasPermission('auth.change_user') && (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div>
        <Button onClick={() => setInEditMode(true)}>{t`Edit`}</Button>
      </div>
    </div>
  );

  return (
    <>
      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
      <UserFormPage
        breadcrumbs={breadcrumbs}
        errorMessages={errorMessages}
        extraControls={extraControls}
        isMe
        isReadonly={!inEditMode}
        onCancel={() => {
          setEdit(null);
          setInEditMode(false);
          setErrorMessages({});
        }}
        saveUser={saveUser}
        title={title}
        updateUser={(next, errors) => {
          setErrorMessages(errors);
          setEdit((current) => ({ form: next, shown: current?.shown ?? read }));
        }}
        user={form}
      />
    </>
  );
}

export default UserProfile;
