import { t } from '@lingui/core/macro';
import {
  GenericDistributionAPI,
  GenericRepositoryAPI,
} from '../api/generic-pulp';
import { parsePulpResource } from './parse-pulp-id';
import { plugin2api } from './plugin-repository-base-path';

// Returns the distribution that serves a repository, looked up by repository
// name. A distribution named like the repository wins when it is bound to that
// repository; otherwise the oldest distribution bound to the repository is
// used. The distribution list comes from the plugin the repository belongs to.
// Rejects when the repository or a distribution for it cannot be found, or
// when the plugin has no distribution API.
// An optional pulp_href skips the repository lookup; an optional
// distributionAPI saves one request.

export interface Distribution {
  pulp_href: string;
  prn: string;
  name: string;
  base_path: string;
  base_url?: string;
  repository?: string;
  publication?: string;
  repository_version?: string;
  remote?: string;
}

export function repositoryDistro(
  name,
  pulp_href?,
  distributionAPI?,
): Promise<Distribution> {
  return Promise.all([
    pulp_href
      ? Promise.resolve({ name, pulp_href })
      : GenericRepositoryAPI.list({ name, page_size: 1 }).then(firstResult),
    distributionAPI
      ? distributionAPI.list({ name, page_size: 1 }).then(firstResult)
      : GenericDistributionAPI.list({ name, page_size: 1 }).then(firstResult),
  ]).then(async ([repository, distribution]) => {
    if (!repository) {
      return Promise.reject(t`Failed to find repository ${name}`);
    }
    const params = {
      repository: repository.pulp_href,
      sort: 'pulp_created',
      page_size: 1,
    };
    if (distribution && distribution.repository === repository.pulp_href) {
      if (distributionAPI) {
        return distribution;
      }
      params['name'] = distribution.name;
    }

    const resource = parsePulpResource(repository.pulp_href);
    const api = plugin2api(resource?.plugin).DistributionAPI;
    if (!api) {
      return Promise.reject(
        t`Distributions of ${resource?.plugin} repositories cannot be looked up`,
      );
    }
    distribution = await api.list(params).then(firstResult);
    if (!distribution) {
      return Promise.reject(
        t`Failed to find a distribution for repository ${name}`,
      );
    }

    return distribution;
  });
}

export function repositoryBasePath(name, pulp_href?): Promise<string> {
  return repositoryDistro(name, pulp_href).then(({ base_path }) => base_path);
}

function firstResult({ data: { results } }) {
  return results[0];
}
