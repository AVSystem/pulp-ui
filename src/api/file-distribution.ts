import { atHref } from 'src/utilities/at-href';
import type { GenericDistribution } from './common';
import { PulpAPI } from './pulp';

/**
 * File Distribution Type.
 *
 * @see https://github.com/pulp/pulpcore/blob/934c752dae916857b2005e1fe0ef75496accc082/pulp_file/app/serializers.py#L225
 */
interface FileDistributionType extends GenericDistribution {
  publication?: string | null;
  checkpoint?: boolean;
}

const base = new PulpAPI();

export const FileDistributionAPI = {
  create: (data) => base.http.post(`distributions/file/file/`, data),

  delete: (href: string) =>
    atHref(href, 'distributions/file/file/', (path) => base.http.delete(path)),

  list: (params?) => base.list(`distributions/file/file/`, params),
};

export type { FileDistributionType };
