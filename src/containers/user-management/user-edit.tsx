import { t } from '@lingui/core/macro';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
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
import { userHref } from 'src/entities/core/user/href';
import { useUpdateUser, useUser } from 'src/entities/core/user/queries';
import { Paths, formatPath } from 'src/paths';
import { useUserContext } from 'src/user-context';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { userSaveErrors } from './save-errors';

// The address holds the id of one user. Another user is another screen:
// nothing of the one left behind stays on screen or in the form.
const UserEdit = () => {
  const { user_id: urlId } = useParams();

  return <UserEditScreen key={urlId} urlId={urlId} />;
};

const UserEditScreen = ({ urlId }: { urlId: string }) => {
  // The id of the address becomes an address of the API only here; an id that
  // is not one has no user and asks for nothing.
  const href = userHref(urlId);
  const query = useUser(href);
  const updateUser = useUpdateUser();
  const { permissionsFailed, permissionsError } = useAppContext();

  const {
    user: sessionUser,
    setUser: setSessionUser,
    endSession,
  } = useUserContext();

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

  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [redirect, setRedirect] = useState<string>();

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
    if (updateUser.isPending || !form || !href) {
      return;
    }

    // The promise, not a callback of the screen: the outcome of a save is
    // acted on even when the screen has gone by then.
    updateUser
      .mutateAsync({
        href,
        changes: userChanges(edit?.shown ?? read, form),
      })
      .then(() => {
        const isOwnRecord = read?.username === sessionUser?.username;

        if (isOwnRecord && form.password) {
          // The server ends every session of a user whose password changes, so
          // the next request would fail. The route guard sends the user to the
          // login page, which explains why.
          endSession('password-changed');
          return;
        }
        if (isOwnRecord && sessionUser?.username !== form.username) {
          // A rename keeps the session.
          setSessionUser({ ...sessionUser, username: form.username });
        }

        setRedirect(formatPath(Paths.core.user.list));
      })
      .catch((error) => setErrorMessages(userSaveErrors(error)));
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  const title = t`Edit user`;

  if (href === null || (!form && status === 404)) {
    return <NotFound />;
  }

  if (!form && status === 403) {
    return (
      <>
        <BaseHeader title={title} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

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

  // The permissions could not be read: nothing is offered on a guess. A failed
  // read of the user is decided before this; a form the user has changed
  // stays, as a later read never replaces what was typed; and a permission
  // read that stopped only because the session ended is not a failure to show:
  // the sign-in dialog explains it.
  if (permissionsFailed && !isSessionEnd(permissionsError) && !edit) {
    return <PermissionsFailed title={title} />;
  }

  if (!form) {
    return <LoadingPage />;
  }

  const breadcrumbs = [
    { url: formatPath(Paths.core.user.list), name: t`Users` },
    {
      url: formatPath(Paths.core.user.detail, { user_id: urlId }),
      name: form.username,
    },
    { name: t`Edit` },
  ];

  return (
    <>
      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
      <UserFormPage
        breadcrumbs={breadcrumbs}
        errorMessages={errorMessages}
        onCancel={() => setRedirect(formatPath(Paths.core.user.list))}
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
};

export default UserEdit;
