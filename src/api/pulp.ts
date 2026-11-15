import Cookies from 'js-cookie';
import {
  SessionSuspendedError,
  isSignedIn,
  isSuspended,
  markSessionEnd,
  reportUnauthorized,
} from 'src/session/session-events';
import { config } from 'src/ui-config';
import { BaseAPI } from './base';

const isLoginCall = (error) =>
  String(error?.config?.url ?? '').startsWith('login/');

// The one who-is-signed-in request that tells an ended session from a real
// refusal. Refusals that arrive together share it.
let sessionCheck: Promise<boolean> | null = null;

export class PulpAPI extends BaseAPI {
  mapPageToOffset = true; // offset & limit
  sortParam = 'ordering';

  constructor() {
    super();

    this.http.interceptors.request.use((request) => {
      request.baseURL = config.API_BASE_PATH;

      // Signing in rotates the CSRF token, so it is read for every request
      // and never cached. The server rejects a state-changing session request
      // that lacks it.
      const csrfToken = Cookies.get('csrftoken');
      if (csrfToken) {
        request.headers['X-CSRFToken'] = csrfToken;
      }

      return request;
    });

    // While the session has ended and the sign-in dialog is open, nothing but
    // a sign-in call leaves the browser: any other request could only collect
    // another refusal. The rejection is recognised by isSessionEnd, and the
    // screens that wanted the data read it again after signing in.
    this.http.interceptors.request.use((request) => {
      if (isSuspended() && !String(request.url ?? '').startsWith('login/')) {
        return Promise.reject(new SessionSuspendedError());
      }

      return request;
    });

    // A 401 of any call except the sign-in calls means the session ended. The
    // request is only reported, never repeated: repeating it could run a
    // delete or a sync a second time. The error still reaches the caller.
    //
    // A 403 of a signed-in user is a refusal, except with an authentication
    // backend that answers an ended session with 403 instead of 401. One
    // who-is-signed-in request tells them apart: a 2xx answer means the
    // refusal is real and the error reaches the caller untouched; a 401 or 403
    // answer means the session ended.
    this.http.interceptors.response.use(undefined, async (error) => {
      const status = error?.response?.status;

      if (status === 401 && !isLoginCall(error)) {
        reportUnauthorized('request');
      } else if (status === 403 && !isLoginCall(error) && isSignedIn()) {
        if (await this.sessionEnded()) {
          markSessionEnd(error);
          reportUnauthorized('request');
        }
      }

      return Promise.reject(error);
    });
  }

  // True when the server says nobody is signed in. A failed check (a server
  // error or a lost connection) says nothing, so it counts as not ended.
  private sessionEnded(): Promise<boolean> {
    sessionCheck ??= this.http
      .get('login/')
      .then(
        () => false,
        (error) => [401, 403].includes(error?.response?.status),
      )
      .finally(() => {
        sessionCheck = null;
      });

    return sessionCheck;
  }
}
