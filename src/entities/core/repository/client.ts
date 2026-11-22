import {
  getRepositoriesListUrl,
  repositoriesList,
} from '@pulp-ui/sdk/core/repositories';
import { z } from 'zod';
import { chunkByUrl } from 'src/entities/batch';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';
import { parseResponse } from 'src/entities/response-shape';

// The repositories of every plugin through the one endpoint that lists them
// all. A screen that shows where some distributions point asks for the
// repositories at known addresses, whatever their plugin, and reads from each
// only what it shows: its name and the address of its latest version.
const repositorySchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  latest_version_href: pulpHrefSchema.nullish(),
});

const repositoryPageSchema = pageSchemaOf(repositorySchema);

export type RepositoryRef = z.infer<typeof repositorySchema>;

const FIELDS = ['pulp_href', 'name', 'latest_version_href'];

// The request that reads the repositories at some addresses with one page: as
// many rows as addresses.
function request(hrefs: readonly string[]) {
  return {
    pulp_href__in: [...hrefs],
    limit: Math.max(hrefs.length, 1),
    fields: FIELDS,
  };
}

// Splits repository addresses into groups, each read by one request whose URL
// stays under the budget. Every address is kept once, in order.
function chunks(hrefs: readonly string[]): string[][] {
  return chunkByUrl(
    (group) => getRepositoriesListUrl(request(group)),
    Array.from(new Set(hrefs)),
  );
}

// The repositories at these addresses with one request. The group should come
// from `chunks`; an empty group sends nothing. A row of an address that was not
// asked for is dropped, so a server that ignores the filter cannot put another
// repository on screen.
async function byHrefs(
  hrefs: readonly string[],
  options?: RequestInit,
): Promise<RepositoryRef[]> {
  if (hrefs.length === 0) {
    return [];
  }
  const data = await repositoriesList(request(hrefs), options);
  const asked = new Set(hrefs);

  return parseResponse(repositoryPageSchema, data).results.filter(
    ({ pulp_href }) => asked.has(pulp_href),
  );
}

// The `pulp_type` of the repositories a plugin's distributions can serve. A
// container distribution serves a mirrored or a pushed repository alike.
const REPOSITORY_TYPES: Readonly<Record<string, readonly string[]>> = {
  file: ['file.file'],
  deb: ['deb.deb'],
  rpm: ['rpm.rpm'],
  python: ['python.python'],
  maven: ['maven.maven'],
  npm: ['npm.npm'],
  ansible: ['ansible.ansible'],
  container: ['container.container', 'container.container-push'],
};

// How many repositories one search offers at a time.
export const REPOSITORY_SEARCH_LIMIT = 20;

const NAME_FIELDS = ['pulp_href', 'name'];

const namedSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
});

const namedPageSchema = pageSchemaOf(namedSchema);

export type NamedRepository = z.infer<typeof namedSchema>;

export interface RepositorySearch {
  // How many repositories match in all.
  count: number;
  results: NamedRepository[];
}

// The types of the plugin's repositories, as the filter takes them. A plugin
// without distributions has none, and asking for its repositories is a mistake
// of the caller.
function typesOf(plugin: string) {
  const types = REPOSITORY_TYPES[plugin];
  if (!types) {
    throw new Error(`The ${plugin} plugin has no repositories to choose from`);
  }

  return [...types] as never;
}

// The repositories of one plugin whose name holds the text, by name, one page
// of at most REPOSITORY_SEARCH_LIMIT and how many match in all. The text is
// sent only as the value of a filter. A failure is thrown for the field to
// show.
async function search(
  plugin: string,
  text: string,
  options?: RequestInit,
): Promise<RepositorySearch> {
  const typed = text.trim();
  const data = await repositoriesList(
    {
      ...(typed ? { name__icontains: typed } : {}),
      limit: REPOSITORY_SEARCH_LIMIT,
      ordering: ['name'],
      pulp_type__in: typesOf(plugin),
      fields: NAME_FIELDS,
    },
    options,
  );
  const found = parseResponse(namedPageSchema, data);

  return { count: found.count, results: found.results };
}

// The repository of the plugin with exactly this name, or null. The name is
// unique, so a row of another name means the filter was not applied; it is not
// this repository. An empty name is no filter and finds nothing.
async function byName(
  plugin: string,
  name: string,
  options?: RequestInit,
): Promise<NamedRepository | null> {
  if (name === '') {
    return null;
  }
  const data = await repositoriesList(
    {
      name,
      limit: 1,
      pulp_type__in: typesOf(plugin),
      fields: NAME_FIELDS,
    },
    options,
  );
  const found = parseResponse(namedPageSchema, data).results[0];

  return found && found.name === name ? found : null;
}

export const RepositoryClient = { chunks, byHrefs, search, byName };
