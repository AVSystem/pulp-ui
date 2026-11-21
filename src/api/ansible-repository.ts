import { atHref } from 'src/utilities/at-href';
import type { AnsibleLastSyncType, GenericRepository } from './common';
import { PulpAPI } from './pulp';

/**
 * Ansible Repository Type.
 *
 * @see https://github.com/pulp/pulp_ansible/blob/0043923641fc7fd3893f8489fd29ff04addc9d71/pulp_ansible/app/serializers.py#L148
 */
interface AnsibleRepositoryType extends GenericRepository {
  last_synced_metadata_time?: string | null;
  gpgkey?: string | null;
  readonly last_sync_task?: AnsibleLastSyncType | null;
  private?: boolean;
  /**
   * NOTE: Not part of the Ansible serializer, populated separately.
   * This should be broken out into its own type and extend the interface.
   */
  my_permissions?: string[];
}

const base = new PulpAPI();

const COLLECTION = 'repositories/ansible/ansible/';

// Members that act on one repository take its address (pulp_href).
const at = (href: string, send: (path: string) => Promise<{ data }>) =>
  atHref(href, COLLECTION, send);

export const AnsibleRepositoryAPI = {
  addContent: (href: string, collection_version_hrefs) =>
    at(href, (path) =>
      base.http.post(`${path}modify/`, {
        add_content_units: collection_version_hrefs,
      }),
    ),

  addRole: (href: string, role) =>
    at(href, (path) => base.http.post(`${path}add_role/`, role)),

  create: (data) => base.http.post(`repositories/ansible/ansible/`, data),

  delete: (href: string) => at(href, (path) => base.http.delete(path)),

  list: (params?) => base.list(`repositories/ansible/ansible/`, params),

  listRoles: (href: string, params?) =>
    at(href, (path) => base.list(`${path}list_roles/`, params)),

  listVersions: (href: string, params?) =>
    at(href, (path) => base.list(`${path}versions/`, params)),

  myPermissions: (href: string, params?) =>
    at(href, (path) => base.list(`${path}my_permissions/`, params)),

  removeContent: (href: string, collection_version_href) =>
    at(href, (path) =>
      base.http.post(`${path}modify/`, {
        remove_content_units: [collection_version_href],
      }),
    ),

  removeRole: (href: string, role) =>
    at(href, (path) => base.http.post(`${path}remove_role/`, role)),

  patch: (href: string, data) =>
    at(href, (path) => base.http.patch(path, data)),

  revert: (href: string, version_href) =>
    at(href, (path) =>
      base.http.post(`${path}modify/`, {
        base_version: version_href,
      }),
    ),

  sync: (href: string, body = {}) =>
    at(href, (path) => base.http.post(`${path}sync/`, body)),
};

export type { AnsibleRepositoryType };
