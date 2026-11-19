import { handleFailure, prepareRequest } from 'src/session/request-policy';
import { config } from 'src/ui-config';
import { BaseAPI } from './base';

// Where the request keeps the context the session policy returned for it, so
// the failure handling can be given the same context.
const POLICY_CONTEXT = 'sessionPolicyContext';

export class PulpAPI extends BaseAPI {
  mapPageToOffset = true; // offset & limit
  sortParam = 'ordering';

  constructor() {
    super();

    // The session policy is shared with the generated client. It holds back
    // requests while the session has ended and adds the CSRF token to the
    // requests that change state.
    this.http.interceptors.request.use((request) => {
      request.baseURL = config.API_BASE_PATH;
      request[POLICY_CONTEXT] = prepareRequest(
        String(request.url ?? ''),
        request.method ?? 'get',
        request.headers,
      );

      return request;
    });

    // Failed answers are handed to the shared session policy (a 401 and a
    // 403 of a signed-in user); the error always still reaches the caller.
    this.http.interceptors.response.use(undefined, async (error) => {
      await handleFailure(
        error?.response?.status,
        String(error?.config?.url ?? ''),
        error,
        () => this.http.get('login/'),
        error?.config?.[POLICY_CONTEXT],
      );

      return Promise.reject(error);
    });
  }
}
