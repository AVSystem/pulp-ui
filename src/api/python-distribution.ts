import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const PythonDistributionAPI = {
  create: (data) => base.http.post(`distributions/python/pypi/`, data),

  delete: (href: string) =>
    atHref(href, 'distributions/python/pypi/', (path) =>
      base.http.delete(path),
    ),

  list: (params?) => base.list(`distributions/python/pypi/`, params),
};
