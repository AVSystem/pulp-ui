import { atHref } from 'src/utilities/at-href';
import { PulpAPI } from './pulp';

export interface DebRepositoryType {
  autopublish?: boolean;
  description: string | null;
  latest_version_href?: string;
  name: string;
  prn?: string;
  publish_upstream_release_fields?: boolean;
  pulp_created?: string;
  pulp_href?: string;
  pulp_labels: Record<string, string>;
  pulp_last_updated?: string;
  remote: string | null;
  retain_repo_versions: number;
  signing_service?: string | null;
  versions_href?: string;
}

const base = new PulpAPI();

export const DebRepositoryAPI = {
  create: (data) => base.http.post(`repositories/deb/apt/`, data),

  delete: (href: string) =>
    atHref(href, 'repositories/deb/apt/', (path) => base.http.delete(path)),

  list: (params?) => base.list(`repositories/deb/apt/`, params),
};
