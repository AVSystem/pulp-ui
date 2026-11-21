import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const GroupAPI = {
  list: (params?) => base.list(`groups/`, params),
};
