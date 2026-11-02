import { PulpAPI } from './pulp';

const base = new PulpAPI();

// Python publications are deprecated, but a distribution can still be bound to
// one, so they are listed to find the distributions serving a repository.
export const PythonPublicationAPI = {
  list: (params?) => base.list(`publications/python/pypi/`, params),
};
