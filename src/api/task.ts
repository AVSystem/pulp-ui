import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const TaskAPI = {
  // The task the address names.
  get: (href: string) => atHref(href, 'tasks/', (path) => base.http.get(path)),

  list: (params?) => base.list(`tasks/`, params),
};
