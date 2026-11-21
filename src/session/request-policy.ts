import Cookies from 'js-cookie';
import { config } from 'src/ui-config';
import {
  SessionSuspendedError,
  currentRequestEpoch,
  isSignedIn,
  isSuspended,
  markSessionEnd,
  reportUnauthorized,
} from './session-events';

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

// The path and query of the URL once the parser removed dot segments, or null
// when it is not still below the API base on this origin, so
// "/base/../elsewhere/" cannot step out of it.
function normalisedUnder(path: string, base: string): string | null {
  const parsed = new URL(path, PARSE_ORIGIN);

  return parsed.origin === PARSE_ORIGIN && parsed.pathname.startsWith(base)
    ? parsed.pathname + parsed.search
    : null;
}

// The URL to request for a generated or server-issued path: the normalised
// path on this origin below the configured API base. It is the path the
// parser resolved, not the text that was given, so every later rule (the
// sign-in test, the failure handling) judges the URL that is requested.
// Anything that would leave the API throws, so no request ever carries the
// session to another place.
export function resolveApiUrl(url: string): string {
  const base: string = config.API_BASE_PATH;
  const path = collapseDoubleSlash(url);
  const resolved =
    path.startsWith(SCHEMA_API_ROOT) && !path.startsWith(base)
      ? base + path.slice(SCHEMA_API_ROOT.length)
      : path;

  const normalised = resolved.startsWith(base)
    ? normalisedUnder(resolved, base)
    : null;

  if (normalised === null) {
    throw new Error('The request was refused because it leaves the API.');
  }

  return normalised;
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

// Whether the URL is the list of roles. Whoever may not read it is refused,
// and that refusal is the answer the caller asked for (what the account may
// read), not a sign that the session ended: a screen reads this list to learn
// what an account may do, and a limited account is refused it by the server's
// access rules. Only the list itself counts, not one role and not the roles
// of a user or group, which are asked for other reasons.
export function isRolesListUrl(url: string): boolean {
  const path = collapseDoubleSlash(url);
  const prefix = [config.API_BASE_PATH, SCHEMA_API_ROOT].find((candidate) =>
    path.startsWith(candidate),
  );

  return (path.slice(prefix?.length ?? 0).split('?')[0] ?? '') === 'roles/';
}

// The methods the server checks the CSRF token of: those that change state.
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Where a header can be set: the headers of a fetch request or of an axios
// request.
interface IHeaderSink {
  set(name: string, value: string): unknown;
}

// What the policy remembers of a request from the moment it is sent. The
// client keeps it and hands it back, unchanged, when the request fails, so a
// rule can compare the failure with the state at send time.
export interface IRequestContext {
  readonly url: string;
  readonly method: string;
  // The session the request was sent for.
  readonly epoch: number;
}

// Runs before every request of either client. While the session has ended and
// the sign-in dialog is open, nothing but a sign-in call leaves the browser:
// any other request could only collect another refusal. The rejection is
// recognised by isSessionEnd, and the screens that wanted the data read it
// again after signing in.
//
// Signing in rotates the CSRF token, so it is read for every request and
// never cached. The server rejects a state-changing session request that
// lacks it, and checks it for no other method, so a safe request never
// carries it.
export function prepareRequest(
  url: string,
  method: string,
  headers: IHeaderSink,
): IRequestContext {
  if (isSuspended() && !isLoginUrl(url)) {
    throw new SessionSuspendedError();
  }

  const upperMethod = method.toUpperCase();
  if (UNSAFE_METHODS.has(upperMethod)) {
    const csrfToken = Cookies.get('csrftoken');
    if (csrfToken) {
      headers.set('X-CSRFToken', csrfToken);
    }
  }

  return { url, method: upperMethod, epoch: currentRequestEpoch() };
}

// The one who-is-signed-in request that tells an ended session from a real
// refusal. Refusals that arrive together share it, whichever client they came
// from.
let sessionCheck: Promise<boolean> | null = null;

// True when the server says nobody is signed in. A failed check (a server
// error or a lost connection) says nothing, so it counts as not ended.
function sessionEnded(check: () => Promise<unknown>): Promise<boolean> {
  sessionCheck ??= check()
    .then(
      () => false,
      (error) => [401, 403].includes(error?.response?.status),
    )
    .finally(() => {
      sessionCheck = null;
    });

  return sessionCheck;
}

// True when the request was sent for a session that has since been resumed or
// replaced. A request without a context was never sent.
const isForOlderSession = (context: IRequestContext | undefined) =>
  context !== undefined && context.epoch < currentRequestEpoch();

// Runs for every failed answer of either client, before the error reaches the
// caller, and never changes it except to note a session end.
//
// A refusal that answers a request sent for a session that has since been
// resumed or replaced says nothing about the current one, and acting on it
// would open the sign-in dialog a second time for one session end. It is
// ignored, and so is the outcome of a who-is-signed-in request that was
// answered after such a change.
//
// A 401 of any call except the sign-in calls means the session ended. The
// request is only reported, never repeated: repeating it could run a delete or
// a sync a second time.
//
// A 403 of a signed-in user is a refusal, except with an authentication
// backend that answers an ended session with 403 instead of 401. One
// who-is-signed-in request, made by `checkSession`, tells them apart: a 2xx
// answer means the refusal is real and the error reaches the caller
// untouched; a 401 or 403 answer means the session ended.
// The one read that is no occasion for that request is the roles list: its
// refusal is an answer, and any later request of an ended session is refused
// again and tells.
export async function handleFailure(
  status: number | undefined,
  url: string,
  error: unknown,
  checkSession: () => Promise<unknown>,
  context: IRequestContext | undefined,
): Promise<void> {
  if (isLoginUrl(url) || isForOlderSession(context)) {
    return;
  }

  if (status === 401) {
    reportUnauthorized('request');
  } else if (
    status === 403 &&
    isSignedIn() &&
    !(context?.method === 'GET' && isRolesListUrl(url))
  ) {
    if ((await sessionEnded(checkSession)) && !isForOlderSession(context)) {
      markSessionEnd(error);
      reportUnauthorized('request');
    }
  }
}
