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
  list: (params?) => base.list(`content/ansible/collection_versions/`, params),
};
