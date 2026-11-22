import {
  contentguardsList,
  getContentguardsListUrl,
} from '@pulp-ui/sdk/core/contentguards';
import { z } from 'zod';
import { chunkByUrl } from 'src/entities/batch';
import { pulpHrefSchema } from 'src/entities/href';
import { pageSchemaOf } from 'src/entities/plugin/model';
import { parseResponse } from 'src/entities/response-shape';

// The content guards of every kind through the one endpoint that lists them
// all. A screen asks only for the names of the guards some distributions are
// protected by.
const guardSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
});

const guardPageSchema = pageSchemaOf(guardSchema);

// The request that reads the names of the guards at some addresses with one
// page: as many rows as addresses.
function namesRequest(hrefs: readonly string[]) {
  return {
    pulp_href__in: [...hrefs],
    limit: Math.max(hrefs.length, 1),
    fields: ['pulp_href', 'name'],
  };
}

// Splits guard addresses into groups, each read by one request whose URL stays
// under the budget. Every address is kept once, in order.
function chunks(hrefs: readonly string[]): string[][] {
  return chunkByUrl(
    (group) => getContentguardsListUrl(namesRequest(group)),
    Array.from(new Set(hrefs)),
  );
}

// The names of the guards at these addresses, by address, with one request. The
// group should come from `chunks`; an empty group sends nothing. A row of an
// address that was not asked for is dropped.
async function names(
  hrefs: readonly string[],
  options?: RequestInit,
): Promise<Map<string, string>> {
  if (hrefs.length === 0) {
    return new Map();
  }
  const data = await contentguardsList(namesRequest(hrefs), options);
  const asked = new Set(hrefs);

  return new Map(
    parseResponse(guardPageSchema, data)
      .results.filter(({ pulp_href }) => asked.has(pulp_href))
      .map(({ pulp_href, name }) => [pulp_href, name]),
  );
}

export const ContentGuardClient = { chunks, names };

// The kind of a content guard, read from its address
// (`.../contentguards/<app>/<kind>/<id>/`): "rbac", "x509", "header",
// "content_redirect" and so on. Null for an address that does not name a
// guard. Reading it costs no request, and the address is what the server
// builds from the guard's own type.
export function guardKindOf(href: string | null | undefined): string | null {
  const match = /\/contentguards\/[^/]+\/([^/]+)\/[^/]+\/?$/.exec(href ?? '');

  return match ? (match[1] as string) : null;
}
