import Cookies from 'js-cookie';
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
  }
}
