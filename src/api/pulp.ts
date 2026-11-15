import Cookies from 'js-cookie';
import { reportUnauthorized } from 'src/session/session-events';
import { config } from 'src/ui-config';
import { BaseAPI } from './base';

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

    // A 401 of any call except the sign-in calls means the session ended. The
    // request is only reported, never repeated: repeating it could run a
    // delete or a sync a second time. The error still reaches the caller.
    this.http.interceptors.response.use(undefined, (error) => {
      if (
        error?.response?.status === 401 &&
        !String(error.config?.url ?? '').startsWith('login/')
      ) {
        reportUnauthorized('request');
      }

      return Promise.reject(error);
    });
  }
}
