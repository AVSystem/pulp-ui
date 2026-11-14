import { t } from '@lingui/core/macro';
import { Button } from '@patternfly/react-core';
import { Link, useLocation } from 'react-router';
import { Paths, formatPath } from 'src/paths';
import { config } from 'src/ui-config';
import { loginURL } from '../utilities/login-url';

interface IProps {
  button?: boolean;
}

export const LoginLink = ({ button }: IProps) => {
  const { pathname, search } = useLocation();
  // The whole address the user is on, so signing in lands back on it.
  const returnPath = `${pathname}${search}`;

  // NOTE: also update AuthHandler#render (src/routes.tsx) when changing this
  if (config.UI_EXTERNAL_LOGIN_URI) {
    const href = loginURL(returnPath);

    return button ? (
      <Button component='a' href={href} variant='primary'>{t`Login`}</Button>
    ) : (
      <a href={href}>{t`Login`}</a>
    );
  }

  const to = formatPath(Paths.meta.login, {}, { next: returnPath });

  return button ? (
    <Button
      component={(props) => <Link {...props} to={to} />}
      variant='primary'
    >{t`Login`}</Button>
  ) : (
    <Link to={to}>{t`Login`}</Link>
  );
};
