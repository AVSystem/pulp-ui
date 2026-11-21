import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const DebDistributionAPI = {
  create: (data) => base.http.post(`distributions/deb/apt/`, data),

  delete: (href: string) =>
    atHref(href, 'distributions/deb/apt/', (path) => base.http.delete(path)),

  list: (params?) => base.list(`distributions/deb/apt/`, params),
};
