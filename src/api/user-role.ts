import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const UserRoleAPI = {
  listRoles: (userId, params?) => base.list(`users/${userId}/roles/`, params),
};
