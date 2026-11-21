import { atHref } from 'src/utilities/at-href';
import type { GenericRepository } from './common';
import { PulpAPI } from './pulp';

/**
 * Python Repository Type.
 *
 * @see https://github.com/pulp/pulp_python/blob/main/pulp_python/app/serializers.py
 */
interface PythonRepositoryType extends GenericRepository {
  /** @deprecated by pulp_python; not offered in the UI */
  autopublish?: boolean;
  allow_package_substitution?: boolean;
  error_on_reject?: boolean;
}

const base = new PulpAPI();

export const PythonRepositoryAPI = {
  create: (data) => base.http.post(`repositories/python/python/`, data),

  delete: (href: string) =>
    atHref(href, 'repositories/python/python/', (path) =>
      base.http.delete(path),
    ),

  list: (params?) => base.list(`repositories/python/python/`, params),

  listVersions: (id: string, params?) =>
    base.list(`repositories/python/python/${id}/versions/`, params),

  patch: (id: string, data) =>
    base.http.patch(`repositories/python/python/${id}/`, data),

  revert: (id: string, version_href) =>
    base.http.post(`repositories/python/python/${id}/modify/`, {
      base_version: version_href,
    }),

  sync: (id: string, body = {}) =>
    base.http.post(`repositories/python/python/${id}/sync/`, body),
};

export type { PythonRepositoryType };
