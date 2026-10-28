import { t } from '@lingui/core/macro';
import { LoginPage } from '@patternfly/react-core';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { PulpLoginAPI } from 'src/api/pulp-login';
import { LoginForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { useUserContext } from 'src/user-context';
import { useQueryParams, withRouter } from 'src/utilities';
import { safeNextPath } from 'src/utilities/safe-next-path';
import PulpLogo from 'static/images/pulp_logo.png';

function PulpLoginPage(_props) {
  const { setUser } = useUserContext();
  const { next } = useQueryParams();

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
      .catch((result) => {
        const response = result?.response;
        if (!response) {
          const message = result?.message || String(result);
          setError(t`The server could not be reached: ${message}`);
        } else if (response.status.toString().startsWith('5')) {
          setError(t`Server error. Please come back later.`);
        } else {
          setError(response.data?.detail || t`Invalid login credentials.`);
        }
      });

    e.preventDefault();
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  return (
    <LoginPage
      style={{
        backgroundColor: 'var(--pf-v5-global--BackgroundColor--dark-100)',
      }}
      loginTitle={t`Login`}
      brandImgSrc={PulpLogo}
    >
      <LoginForm
        helperText={
          <>
            {error ? (
              <span style={{ color: 'var(--pf-v5-global--danger-color--100)' }}>
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
