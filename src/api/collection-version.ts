import { PulpAPI } from './pulp';

const base = new PulpAPI();

/**
 * One row of the plain content listing of ansible collection versions.
 *
 * Only the fields the screens use; the server sends more.
 */
export interface AnsibleCollectionVersion {
  pulp_href: string;
  namespace: string;
  name: string;
  version: string;
  description?: string;
}

export const CollectionVersionAPI = {
  get: (id: string) =>
    base.http.get(`content/ansible/collection_versions/${id}/`),

  list: (params?) => base.list(`content/ansible/collection_versions/`, params),
};
