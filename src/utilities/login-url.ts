import { config } from 'src/ui-config';

// external login URL, assuming UI_EXETRNAL_LOGIN_URI is set
export const loginURL = (next) => {
  const { UI_BASE_PATH, UI_EXTERNAL_LOGIN_URI } = config;

  if (next) {
    // Only the path part is normalised: a double slash inside the query string
    // belongs to a value and must reach the login service unchanged.
    const queryStart = next.indexOf('?');
    const path = queryStart === -1 ? next : next.slice(0, queryStart);
    const query = queryStart === -1 ? '' : next.slice(queryStart);
    const fullPath = `${`${UI_BASE_PATH}/${path}`.replaceAll(/\/+/g, '/')}${query}`;
    return `${UI_EXTERNAL_LOGIN_URI}?next=${encodeURIComponent(fullPath)}`;
  }

  return UI_EXTERNAL_LOGIN_URI;
};
