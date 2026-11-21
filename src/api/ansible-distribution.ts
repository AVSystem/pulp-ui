import { atHref } from 'src/utilities/at-href';
import type { GenericDistribution } from './common';
import { PulpAPI } from './pulp';

/**
 * Ansible Distribution Type.
 *
 * @see https://github.com/pulp/pulp_ansible/blob/0043923641fc7fd3893f8489fd29ff04addc9d71/pulp_ansible/app/serializers.py#L356
 */
interface AnsibleDistributionType extends Omit<
  GenericDistribution,
  'base_url'
> {
  readonly client_url: string;
  repository_version?: string | null;
}

const base = new PulpAPI();

export const AnsibleDistributionAPI = {
  create: (data) => base.http.post(`distributions/ansible/ansible/`, data),

  delete: (href: string) =>
    atHref(href, 'distributions/ansible/ansible/', (path) =>
      base.http.delete(path),
    ),

  list: (params?) => base.list(`distributions/ansible/ansible/`, params),

  url: (distro_data) => distro_data.client_url,
};

export type { AnsibleDistributionType };
