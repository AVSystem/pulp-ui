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

export const RepositoryClient = { chunks, byHrefs };
