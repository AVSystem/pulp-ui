import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const UserRoleAPI = {
  // The roles of the user the address names.
  listRoles: (userHref: string, params?) =>
    atHref(userHref, 'users/', (path) => base.list(`${path}roles/`, params)),
};
