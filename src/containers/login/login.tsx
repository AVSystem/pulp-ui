import { t } from '@lingui/core/macro';
import { LoginPage } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { PulpLoginAPI } from 'src/api/pulp-login';
import { FormFieldHelper, LoginForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { sessionKey, useUserContext } from 'src/user-context';
import { useQueryParams, withRouter } from 'src/utilities';
import { safeNextPath } from 'src/utilities/safe-next-path';
import { uiPath } from 'src/utilities/ui-path';
import PulpLogo from 'static/images/pulp_logo.png';
import { loginErrorMessage } from '../../utilities/login-error';
import './login.scss';

function PulpLoginPage(_props) {
  const { user: current, setUser } = useUserContext();
  const { next, reason } = useQueryParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [redirect, setRedirect] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // One login request per attempt, also before the disabled state renders.
  const inFlight = useRef(false);
  // The account in memory when the answer arrives.
  const inMemory = useRef(current);
  inMemory.current = current;

  const onLoginClick = (e) => {
    e.preventDefault();
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError('');

    PulpLoginAPI.login(username, password)
      .then(({ data }) => {
        const signedIn = { username: data.username, pulp_href: data.pulp_href };
        const target = safeNextPath(next, formatPath(Paths.core.status));

        if (
          inMemory.current &&
          sessionKey(signedIn) !== sessionKey(inMemory.current)
        ) {
          // Everything in memory belongs to the previous account. A full page
          // load drops all of it in one step; the form stays disabled until
          // the page is gone.
          window.location.assign(uiPath(target));
          return;
        }

        setUser(signedIn);
        setRedirect(target);
      })
      .catch((result) => {
        setError(loginErrorMessage(result));
        inFlight.current = false;
        setSubmitting(false);
      });
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  return (
    <LoginPage
      className='pulp-login'
      loginTitle={t`Login`}
      brandImgSrc={PulpLogo}
    >
      <LoginForm
        helperText={
          <>
            {reason === 'password-changed' ? (
              <FormFieldHelper>
                {t`Your password was changed. Sign in with the new password.`}
              </FormFieldHelper>
            ) : null}
            {error ? (
              <span className='pulp-login__error'>
                <ExclamationCircleIcon /> {error}
              </span>
            ) : null}
          </>
        }
        onChangePassword={(_e, value) => setPassword(value)}
        onChangeUsername={(_e, value) => setUsername(value)}
        onLoginButtonClick={onLoginClick}
        passwordValue={password}
        showHelperText
        isLoginButtonDisabled={submitting}
        usernameValue={username}
      />
    </LoginPage>
  );
}

export default withRouter(PulpLoginPage);
