import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const GroupRoleAPI = {
  // The roles of the group the address names.
  listRoles: (groupHref: string, params?) =>
    atHref(groupHref, 'groups/', (path) => base.list(`${path}roles/`, params)),
};
