import { atHref } from 'src/utilities/at-href';
import type { AnsibleLastSyncType, GenericRemote } from './common';
import { PulpAPI } from './pulp';

/**
 * Ansible Remote Type.
 *
 * @see https://github.com/pulp/pulp_ansible/blob/0043923641fc7fd3893f8489fd29ff04addc9d71/pulp_ansible/app/serializers.py#L213
 */
interface AnsibleRemoteType extends GenericRemote {
  requirements_file?: string | null;
  auth_url?: string | null;
  token?: string | null;
  sync_dependencies?: boolean;
  signed_only?: boolean;
  readonly last_sync_task?: AnsibleLastSyncType | null;
  /**
   * NOTE: Not part of the Ansible serializer, populated separately.
   * This should be broken out into its own type and extend the interface.
   */
  my_permissions?: string[];
}

// simplified version of smartUpdate from execution-environment-registry
function smartUpdate(
  remote: AnsibleRemoteType,
  unmodifiedRemote: AnsibleRemoteType,
) {
  // Pulp complains if auth_url gets sent with a request that doesn't include a
  // valid token, even if the token exists in the database and isn't being changed.
  // To solve this issue, simply delete auth_url from the request if it hasn't
  // been updated by the user.
  if (remote.auth_url === unmodifiedRemote.auth_url) {
    delete remote.auth_url;
  }

  for (const field of Object.keys(remote)) {
    if (remote[field] === '') {
      remote[field] = null;
    }

    // API returns headers:null bull doesn't accept it .. and we don't edit headers
    if (remote[field] === null && unmodifiedRemote[field] === null) {
      delete remote[field];
    }
  }

  return remote;
}

const base = new PulpAPI();

const COLLECTION = 'remotes/ansible/collection/';

// Members that act on one remote take its address (pulp_href).
const at = (href: string, send: (path: string) => Promise<{ data }>) =>
  atHref(href, COLLECTION, send);

export const AnsibleRemoteAPI = {
  addRole: (href: string, role) =>
    at(href, (path) => base.http.post(`${path}add_role/`, role)),

  create: (data) => base.http.post(`remotes/ansible/collection/`, data),

  delete: (href: string) => at(href, (path) => base.http.delete(path)),

  get: (href: string) => at(href, (path) => base.http.get(path)),

  list: (params?) => base.list(`remotes/ansible/collection/`, params),

  listRoles: (href: string, params?) =>
    at(href, (path) => base.list(`${path}list_roles/`, params)),

  myPermissions: (href: string, params?) =>
    at(href, (path) => base.list(`${path}my_permissions/`, params)),

  removeRole: (href: string, role) =>
    at(href, (path) => base.http.post(`${path}remove_role/`, role)),

  smartUpdate: (
    href: string,
    newValue: AnsibleRemoteType,
    oldValue: AnsibleRemoteType,
  ) => at(href, (path) => base.http.put(path, smartUpdate(newValue, oldValue))),
};

export type { AnsibleRemoteType };
