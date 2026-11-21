import { atHref } from 'src/utilities/at-href';
import type { GenericDistribution } from './common';
import { PulpAPI } from './pulp';

/**
 * RPM Distribution Type.
 *
 * @see https://github.com/pulp/pulp_rpm/blob/main/pulp_rpm/app/serializers/repository.py
 */
interface RPMDistributionType extends GenericDistribution {
  publication?: string | null;
  generate_repo_config?: boolean;
}

const base = new PulpAPI();

export const RPMDistributionAPI = {
  create: (data) => base.http.post(`distributions/rpm/rpm/`, data),

  delete: (href: string) =>
    atHref(href, 'distributions/rpm/rpm/', (path) => base.http.delete(path)),

  list: (params?) => base.list(`distributions/rpm/rpm/`, params),
};

export type { RPMDistributionType };
