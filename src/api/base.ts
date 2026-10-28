import axios from 'axios';
import { ParamHelper } from '../utilities/param-helper';

export class BaseAPI {
  http: { delete; get; interceptors; patch; post; put };
  sortParam: string; // translate ?sort into sortParam in list()
  mapPageToOffset: boolean;

  constructor() {
    this.http = axios.create({
      adapter: 'fetch',
      // The API is same-origin and signed-in calls are authenticated by the
      // session cookie, so the cookie must travel with every request.
      withCredentials: true,
      // With the cookie enabled, a 401 answered with a plain Basic challenge
      // can make the browser open its own password dialog. This header makes
      // the server answer with a challenge browsers leave alone.
      headers: { 'X-Requested-With': 'XMLHttpRequest' },

      // baseURL gets set in PulpAPI
      paramsSerializer: {
        serialize: (params) => ParamHelper.getQueryString(params),
      },
    });
  }

  mapParams(params) {
    const newParams = { ...params };

    if (this.mapPageToOffset) {
      // The api uses offset/limit OR page/page_size for pagination
      // the UI uses page/page size and maps to whatever the api expects

      const pageSize = parseInt(newParams['page_size'], 10) || 10;
      const page = parseInt(newParams['page'], 10) || 1;

      delete newParams['page'];
      delete newParams['page_size'];

      newParams['offset'] = page * pageSize - pageSize;
      newParams['limit'] = pageSize;
    }

    if (this.sortParam && newParams['sort'] && this.sortParam !== 'sort') {
      // The api uses sort/ordering/order_by for sort
      // the UI uses sort and maps to whatever the api expects

      newParams[this.sortParam] = newParams['sort'];
      delete newParams['sort'];
    }

    return {
      params: newParams,
    };
  }

  list(url: string, params?) {
    return this.http.get(url, this.mapParams(params));
  }
}
