import { config } from 'src/ui-config';

// The prefix the generated sdk was produced with. The deployment's real API
// base comes from the configuration file, so every generated path is moved
// from this root to the configured base before it is requested.
export const SCHEMA_API_ROOT = '/pulp/api/v3/';

// Only used to let the URL parser normalise a path (dot segments, escapes);
// nothing is ever requested from it.
const PARSE_ORIGIN = 'http://api.invalid';

// Collapses a leading "//". Paths built from a server-issued href come out of
// the generator as "//pulp/api/v3/...": a protocol-relative URL that the
// browser would send to the host named by the first path segment, together
// with the session cookie and the CSRF token. A single slash keeps the request
// on this origin.
const collapseDoubleSlash = (url: string) =>
  url.startsWith('//') ? url.slice(1) : url;

// True when the path, once the parser removed dot segments, is still below the
// API base on this origin, so "/base/../elsewhere/" cannot step out of it.
function staysUnder(path: string, base: string) {
  const parsed = new URL(path, PARSE_ORIGIN);
  return parsed.origin === PARSE_ORIGIN && parsed.pathname.startsWith(base);
}

// The URL to request for a generated or server-issued path: the path on this
// origin below the configured API base. Anything that would leave the API
// throws, so no request ever carries the session to another place.
export function resolveApiUrl(url: string): string {
  const base: string = config.API_BASE_PATH;
  const path = collapseDoubleSlash(url);
  const resolved =
    path.startsWith(SCHEMA_API_ROOT) && !path.startsWith(base)
      ? base + path.slice(SCHEMA_API_ROOT.length)
      : path;

  if (!resolved.startsWith(base) || !staysUnder(resolved, base)) {
    throw new Error('The request was refused because it leaves the API.');
  }

  return resolved;
}

// Whether the URL is one of the sign-in calls: relative to the base as the
// legacy client writes it, or a full path under the configured base or the
// schema root as the generated client writes it.
export function isLoginUrl(url: string): boolean {
  const path = collapseDoubleSlash(url);
  const prefix = [config.API_BASE_PATH, SCHEMA_API_ROOT].find((candidate) =>
    path.startsWith(candidate),
  );

  return path.slice(prefix?.length ?? 0).startsWith('login/');
}
