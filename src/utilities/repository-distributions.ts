import {
  DebPublicationAPI,
  DebVerbatimPublicationAPI,
} from '../api/deb-publication';
import { FilePublicationAPI } from '../api/file-publication';
import {
  SERVES_FROM_PUBLICATION,
  distributionUrl,
  repositoryOfVersion,
  servedState,
} from './distribution-serving';
import { errorMessage } from './fail-alerts';
import { plugin2api } from './plugin-repository-base-path';

// Every distribution that serves a repository, with the URL the server
// reports for it and whether the content app answers with content.

export type RepositoryDistributionPlugin = 'ansible' | 'deb' | 'file';

export interface RepositoryDistribution {
  pulp_href: string;
  name: string;
  base_path: string;
  // base_url (client_url for ansible) as returned by the server, never built
  // from base_path
  url: string | null;
  served: boolean;
  // what the distribution is bound to
  binding: 'repository' | 'publication' | 'repository_version';
  content_guard: string | null;
  pulp_created: string;
}

interface DistributionRecord {
  pulp_href: string;
  name: string;
  base_path: string;
  base_url?: string | null;
  client_url?: string | null;
  publication?: string | null;
  repository?: string | null;
  repository_version?: string | null;
  content_guard?: string | null;
  pulp_created: string;
}

interface PublicationRecord {
  pulp_href: string;
  repository_version?: string | null;
}

const PAGE_SIZE = 500;

// Publication endpoints per plugin. A deb distribution may serve either kind
// of publication. Ansible serves without publications.
const PUBLICATION_APIS: Record<
  RepositoryDistributionPlugin,
  {
    list: (params?) => Promise<{
      data: { count: number; results: PublicationRecord[] };
    }>;
  }[]
> = {
  ansible: [],
  deb: [DebPublicationAPI, DebVerbatimPublicationAPI],
  file: [FilePublicationAPI],
};

const COMMON_FIELDS = [
  'pulp_href',
  'name',
  'base_path',
  'content_guard',
  'pulp_created',
  'repository',
  'repository_version',
];

function distributionFields(plugin: RepositoryDistributionPlugin): string {
  // ansible distributions carry client_url and no publication; the others
  // carry base_url and may be bound to a publication
  return (
    plugin === 'ansible'
      ? [...COMMON_FIELDS, 'client_url']
      : [...COMMON_FIELDS, 'base_url', 'publication']
  ).join(',');
}

// Reads every page of a list endpoint. An error on any page rejects, so a
// partial list is never mistaken for a complete one.
async function listAll<T>(
  list: (params) => Promise<{ data: { count: number; results: T[] } }>,
  params: Record<string, unknown>,
): Promise<T[]> {
  const collected: T[] = [];

  for (let page = 1; ; page++) {
    const { data } = await list({ ...params, page, page_size: PAGE_SIZE });
    collected.push(...data.results);

    if (data.results.length < PAGE_SIZE || collected.length >= data.count) {
      return collected;
    }
  }
}

function bindingOf(
  distribution: DistributionRecord,
): RepositoryDistribution['binding'] {
  if (distribution.publication) {
    return 'publication';
  }
  return distribution.repository_version ? 'repository_version' : 'repository';
}

// Distributions serving a repository: the ones bound to the repository, and
// for plugins that serve from publications also the ones bound to one of its
// publications or to one of its versions. Every error propagates to the
// caller.
export async function repositoryDistributions(
  plugin: RepositoryDistributionPlugin,
  repositoryHref: string,
): Promise<RepositoryDistribution[]> {
  const { DistributionAPI } = plugin2api(plugin);
  const fields = distributionFields(plugin);
  const servesFromPublication = SERVES_FROM_PUBLICATION[plugin];

  const [bound, publications, scanned] = await Promise.all([
    listAll<DistributionRecord>((params) => DistributionAPI.list(params), {
      repository: repositoryHref,
      fields,
    }),
    servesFromPublication
      ? Promise.all(
          PUBLICATION_APIS[plugin].map((api) =>
            listAll<PublicationRecord>((params) => api.list(params), {
              repository: repositoryHref,
              fields: 'pulp_href,repository_version',
            }),
          ),
        ).then((lists) => lists.flat())
      : Promise.resolve([]),
    // The distribution endpoints cannot filter by publication, so this one
    // paged scan of all distributions of the plugin is how the ones bound to a
    // publication or a version of the repository are found.
    servesFromPublication
      ? listAll<DistributionRecord>((params) => DistributionAPI.list(params), {
          fields,
        })
      : Promise.resolve([]),
  ]);

  const publicationHrefs = new Set(
    publications.map((publication) => publication.pulp_href),
  );
  const serving = new Map<string, DistributionRecord>();

  bound.forEach((distribution) =>
    serving.set(distribution.pulp_href, distribution),
  );
  scanned
    .filter(
      (distribution) =>
        (distribution.publication &&
          publicationHrefs.has(distribution.publication)) ||
        repositoryOfVersion(distribution.repository_version) === repositoryHref,
    )
    .forEach((distribution) =>
      serving.set(distribution.pulp_href, distribution),
    );

  return Array.from(serving.values())
    .map(
      (distribution): RepositoryDistribution => ({
        pulp_href: distribution.pulp_href,
        name: distribution.name,
        base_path: distribution.base_path,
        url: distributionUrl(distribution),
        served:
          servedState(distribution, servesFromPublication, publications) ===
          'served',
        binding: bindingOf(distribution),
        content_guard: distribution.content_guard ?? null,
        pulp_created: distribution.pulp_created,
      }),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A readable reason for a failed load, for the page to show. Network errors
// carry no response, so the response is checked before it is read.
export function distributionsLoadError(error): string {
  if (error?.response) {
    return errorMessage(error.response.status, error.response.statusText);
  }
  return error?.message || String(error);
}

// The distributions of a repository as the Distributions tab lists them:
// filtered by case-insensitive contains on name and base_path, sorted by the
// `sort` param (leading '-' for descending) and cut to one page.
export function listLoadedDistributions(
  distributions: RepositoryDistribution[],
  params: {
    name__icontains?: string;
    base_path__icontains?: string;
    sort?: string;
    page?: number | string;
    page_size?: number | string;
  } = {},
): { data: { count: number; results: RepositoryDistribution[] } } {
  const contains = (value: string, needle?: string) =>
    !needle || value.toLowerCase().includes(String(needle).toLowerCase());

  const filtered = distributions.filter(
    ({ name, base_path }) =>
      contains(name, params.name__icontains) &&
      contains(base_path, params.base_path__icontains),
  );

  const descending = params.sort?.startsWith('-');
  const key = descending ? params.sort.slice(1) : params.sort;

  if (key) {
    filtered.sort((a, b) => {
      const order = String(a[key] ?? '').localeCompare(String(b[key] ?? ''));
      return descending ? -order : order;
    });
  }

  const pageSize = parseInt(String(params.page_size), 10) || 10;
  const page = parseInt(String(params.page), 10) || 1;

  return {
    data: {
      count: filtered.length,
      results: filtered.slice((page - 1) * pageSize, page * pageSize),
    },
  };
}
