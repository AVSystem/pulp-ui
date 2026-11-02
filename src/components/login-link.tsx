import { t } from '@lingui/core/macro';
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
  const className = button ? 'pf-v5-c-button pf-m-primary' : '';

  // NOTE: also update AuthHandler#render (src/routes.tsx) when changing this
  if (config.UI_EXTERNAL_LOGIN_URI) {
    return <a className={className} href={loginURL(returnPath)}>{t`Login`}</a>;
  }

  return (
    <Link
      className={className}
      to={formatPath(Paths.meta.login, {}, { next: returnPath })}
    >{t`Login`}</Link>
  );
};
