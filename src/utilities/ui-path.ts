import { config } from 'src/ui-config';

// The address, below the base path the UI is served under, of an in-app path
// that may carry a query string. Only the path part is normalised: a double
// slash inside a query value belongs to the value.
export function uiPath(path: string): string {
  const queryStart = path.indexOf('?');
  const route = queryStart === -1 ? path : path.slice(0, queryStart);
  const query = queryStart === -1 ? '' : path.slice(queryStart);
  return `${`${config.UI_BASE_PATH}/${route}`.replaceAll(/\/+/g, '/')}${query}`;
}
