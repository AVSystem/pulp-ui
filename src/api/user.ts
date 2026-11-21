import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const UserAPI = {
  list: (params?) => base.list(`users/`, params),
};
