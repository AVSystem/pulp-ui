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

  delete: (id) => base.http.delete(`distributions/rpm/rpm/${id}/`),

  list: (params?) => base.list(`distributions/rpm/rpm/`, params),
};

export type { RPMDistributionType };
