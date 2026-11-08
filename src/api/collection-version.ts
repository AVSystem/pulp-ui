import { PulpAPI } from './pulp';

const base = new PulpAPI();

export const CollectionVersionAPI = {
  get: (id: string) =>
    base.http.get(`content/ansible/collection_versions/${id}/`),

  list: (params?) => base.list(`content/ansible/collection_versions/`, params),
};
