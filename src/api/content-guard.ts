import { PulpAPI } from './pulp';

const base = new PulpAPI();

// Content guards of every kind, as one list.
export const ContentGuardAPI = {
  list: (params?) => base.list(`contentguards/`, params),
};
