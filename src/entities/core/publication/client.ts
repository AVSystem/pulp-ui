import {
  getPublicationsListUrl,
  publicationsList,
} from '@pulp-ui/sdk/core/publications';
import { z } from 'zod';
import { chunkByUrl } from 'src/entities/batch';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';
import { parseResponse } from 'src/entities/response-shape';

// The publications of every plugin through the one endpoint that lists them
// all. A screen that shows what some distributions serve asks for the
// publications at known addresses, whatever their plugin, and reads from each
// only where it came from: its repository and the repository version.
const publicationSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  repository: pulpHrefSchema.nullish(),
  repository_version: pulpHrefSchema.nullish(),
});

const publicationPageSchema = pageSchemaOf(publicationSchema);

export type PublicationRef = z.infer<typeof publicationSchema>;

const FIELDS = ['pulp_href', 'repository', 'repository_version'];

// The request that reads the publications at some addresses with one page: as
// many rows as addresses.
function request(hrefs: readonly string[]) {
  return {
    pulp_href__in: [...hrefs],
    limit: Math.max(hrefs.length, 1),
    fields: FIELDS,
  };
}

// Splits publication addresses into groups, each read by one request whose URL
// stays under the budget. Every address is kept once, in order.
function chunks(hrefs: readonly string[]): string[][] {
  return chunkByUrl(
    (group) => getPublicationsListUrl(request(group)),
    Array.from(new Set(hrefs)),
  );
}

// The publications at these addresses with one request. The group should come
// from `chunks`; an empty group sends nothing. A row of an address that was not
// asked for is dropped.
async function byHrefs(
  hrefs: readonly string[],
  options?: RequestInit,
): Promise<PublicationRef[]> {
  if (hrefs.length === 0) {
    return [];
  }
  const data = await publicationsList(request(hrefs), options);
  const asked = new Set(hrefs);

  return parseResponse(publicationPageSchema, data).results.filter(
    ({ pulp_href }) => asked.has(pulp_href),
  );
}

export const PublicationClient = { chunks, byHrefs };
