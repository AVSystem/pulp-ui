import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const PythonDistributionAPI = {
  create: (data) => base.http.post(`distributions/python/pypi/`, data),

  delete: (id) => base.http.delete(`distributions/python/pypi/${id}/`),

  get: (id) => base.http.get(`distributions/python/pypi/${id}/`),

  list: (params?) => base.list(`distributions/python/pypi/`, params),

  // Sends only the given fields, so a field changed elsewhere meanwhile is not
  // overwritten with a stale value.
  patch: (id, data) =>
    base.http.patch(`distributions/python/pypi/${id}/`, data),
};
