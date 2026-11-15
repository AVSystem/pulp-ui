import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { UserAPI, type UserType } from 'src/api';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  InsufficientPermissions,
  LoadingPage,
  NotFound,
  UserFormPage,
  closeAlert,
} from 'src/components';
import { useSessionEpoch, useUserContext } from 'src/user-context';
import {
  type ErrorMessagesType,
  type RouteProps,
  mapErrorMessages,
  withRouter,
} from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

function UserProfile(_props: RouteProps) {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [inEditMode, setInEditMode] = useState<boolean>(false);
  const [initialState, setInitialState] = useState<UserType>();
  const [notFound, setNotFound] = useState<boolean>(false);
  // Pulp refused the read of the profile, with its reason when it gave one.
  const [refused, setRefused] = useState<{ detail: string | null } | null>(
    null,
  );
  const [user, setUser] = useState<UserType>();

  const {
    user: sessionUser,
    setUser: setSessionUser,
    endSession,
  } = useUserContext();
  const username = sessionUser?.username;

  const addAlert = (alert: AlertType) => {
    setAlerts([...alerts, alert]);
  };

  // grows when the same user signs in again, so the profile is read again
  const epoch = useSessionEpoch();
  const firstEpoch = useRef(epoch);
  // true once the form was changed: a later read never replaces what was typed
  const touched = useRef(false);

  const loadUser = () =>
    UserAPI.list({
      username,
      page_size: 1,
    })
      .then(
        ({
          data: {
            results: [result],
          },
        }) => {
          // The api doesn't return a value for the password, so set a blank one here
          // to keep react from getting confused
          const extendedResult = { ...result, password: '' };
          setInitialState({ ...extendedResult });
          if (!touched.current) {
            setUser(extendedResult);
          }
        },
      )
      .catch((e) => {
        // The session ended: the sign-in dialog explains it, and the page
        // keeps its spinner or its form until it reads again.
        if (isSessionEnd(e)) {
          return;
        }
        // A refused read is not a missing profile: the user is told they may
        // not view it, with Pulp's own reason.
        if (requestErrorStatus(e) === 403) {
          setRefused({ detail: requestErrorDetail(e) });
        } else {
          setNotFound(true);
        }
      });

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (epoch !== firstEpoch.current && !refused) {
      loadUser();
    }
  }, [epoch]);

  const saveUser = () =>
    UserAPI.saveUser(user)
      .then(() => {
        touched.current = false;
        setInEditMode(false);
        addAlert({
          variant: 'success',
          title: t`Saved changes to user "${username}".`,
        });

        if (user.password) {
          // The server ends every session of a user whose password changes, so
          // the next request would fail. The route guard sends the user to the
          // login page, which explains why.
          endSession('password-changed');
        } else if (username !== user.username) {
          // A rename keeps the session.
          setSessionUser({ ...sessionUser, username: user.username });
        }
      })
      .catch((err) => setErrorMessages(mapErrorMessages(err)));

  if (refused) {
    return (
      <>
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={refused.detail} />
      </>
    );
  }

  if (notFound) {
    return <NotFound />;
  }

  if (!user) {
    return <LoadingPage />;
  }

  const breadcrumbs = [{ name: t`Settings` }, { name: t`My profile` }];
  const title = t`My profile`;
  const extraControls = !inEditMode && (
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
        closeAlert={(i) =>
          closeAlert(i, {
            alerts,
            setAlerts,
          })
        }
      />
      <UserFormPage
        breadcrumbs={breadcrumbs}
        errorMessages={errorMessages}
        extraControls={extraControls}
        isMe
        isReadonly={!inEditMode}
        onCancel={() => {
          touched.current = false;
          setUser(initialState);
          setInEditMode(false);
          setErrorMessages({});
        }}
        saveUser={saveUser}
        title={title}
        updateUser={(user, errorMessages) => {
          touched.current = true;
          setErrorMessages(errorMessages);
          setUser(user);
        }}
        user={user}
      />
    </>
  );
}

export default withRouter(UserProfile);
