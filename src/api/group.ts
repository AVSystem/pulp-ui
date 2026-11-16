import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const GroupAPI = {
  addUserToGroup: (id, username) =>
    base.http.post(`groups/${id}/users/`, {
      username: username,
    }),

  create: (data) => base.http.post(`groups/`, data),

  delete: (id) => base.http.delete(`groups/${id}/`),

  get: (id) => base.http.get(`groups/${id}/`),

  getUsers: (id, params?) => base.list(`groups/${id}/users/`, params),

  list: (params?) => base.list(`groups/`, params),

  // Removes one user from the group. Pulp authorises it with the permission
  // to change the group, not the permission to change users.
  removeUserFromGroup: (id, userId) =>
    base.http.delete(`groups/${id}/users/${userId}/`),

  update: (id, data) => base.http.put(`groups/${id}/`, data),
};
