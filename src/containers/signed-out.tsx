import { t } from '@lingui/core/macro';
import { Button, LoginPage } from '@patternfly/react-core';
import { Paths, formatPath } from 'src/paths';
import { config } from 'src/ui-config';
import { loginURL } from 'src/utilities/login-url';
import { uiPath } from 'src/utilities/ui-path';
import PulpLogo from 'static/images/pulp_logo.png';
import './login/login.scss';

// Shown after logging out of an installation that signs in through an external
// login service. The Pulp session is already over, so the page asks nothing of
// the server and never sends the browser anywhere by itself: only the button
// leaves it, so signing out cannot turn into signing straight back in.
export default function SignedOut() {
  const start = formatPath(Paths.core.status);
  const href = config.UI_EXTERNAL_LOGIN_URI
    ? loginURL(start)
    : uiPath(formatPath(Paths.meta.login));

  return (
    <LoginPage
      className='pulp-login'
      loginTitle={t`Signed out`}
      brandImgSrc={PulpLogo}
    >
      <p className='pulp-signed-out__text'>{t`You have been signed out of Pulp.`}</p>
      <Button
        component='a'
        href={href}
        isBlock
        variant='primary'
      >{t`Sign in again`}</Button>
    </LoginPage>
  );
}
