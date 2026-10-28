import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { UserAPI, type UserType } from 'src/api';
import {
  AlertList,
  type AlertType,
  LoadingPage,
  NotFound,
  UserFormPage,
  closeAlert,
} from 'src/components';
import { useUserContext } from 'src/user-context';
import {
  type ErrorMessagesType,
  type RouteProps,
  mapErrorMessages,
  withRouter,
} from 'src/utilities';

function UserProfile(_props: RouteProps) {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [inEditMode, setInEditMode] = useState<boolean>(false);
  const [initialState, setInitialState] = useState<UserType>();
  const [notFound, setNotFound] = useState<boolean>(false);
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

  useEffect(() => {
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
          setUser(extendedResult);
        },
      )
      .catch(() => setNotFound(true));
  }, []);

  const saveUser = () =>
    UserAPI.saveUser(user)
      .then(() => {
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
          setUser(initialState);
          setInEditMode(false);
          setErrorMessages({});
        }}
        saveUser={saveUser}
        title={title}
        updateUser={(user, errorMessages) => {
          setErrorMessages(errorMessages);
          setUser(user);
        }}
        user={user}
      />
    </>
  );
}

export default withRouter(UserProfile);
