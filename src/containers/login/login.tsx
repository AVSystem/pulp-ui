import { t } from '@lingui/core/macro';
import { LoginPage } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { PulpLoginAPI } from 'src/api/pulp-login';
import { FormFieldHelper, LoginForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { useUserContext } from 'src/user-context';
import { useQueryParams, withRouter } from 'src/utilities';
import { safeNextPath } from 'src/utilities/safe-next-path';
import PulpLogo from 'static/images/pulp_logo.png';
import { loginErrorMessage } from '../../utilities/login-error';
import './login.scss';

function PulpLoginPage(_props) {
  const { setUser } = useUserContext();
  const { next, reason } = useQueryParams();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [redirect, setRedirect] = useState('');

  const onLoginClick = (e) => {
    PulpLoginAPI.login(username, password)
      .then(({ data }) => {
        setUser({ username: data.username, pulp_href: data.pulp_href });
        setRedirect(safeNextPath(next, formatPath(Paths.core.status)));
      })
      .catch((result) => setError(loginErrorMessage(result)));

    e.preventDefault();
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
        usernameValue={username}
      />
    </LoginPage>
  );
}

export default withRouter(PulpLoginPage);
