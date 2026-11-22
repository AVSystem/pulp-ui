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

// How many guards one search asks for.
export const GUARD_SEARCH_LIMIT = 20;

// Every type of content guard a distribution can be protected by, as the server
// names them, in the order of the names. The guard a container registry manages
// for itself (`core.content_redirect`) is left out: the server attaches it, and
// choosing it by hand would protect nothing a person can reason about.
const SEARCHABLE_TYPES = [
  'certguard.rhsm',
  'certguard.x509',
  'core.composite',
  'core.envvar_header',
  'core.header',
  'core.rbac',
] as const;

// What a search shows of a guard: where it is, what it is called and, from its
// address, what kind it is.
const foundSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().optional(),
  name: z.string(),
});

const foundPageSchema = pageSchemaOf(foundSchema);

export interface GuardMatch {
  pulp_href: string;
  name: string;
}

// One page of a search: how many guards match in all, and the first few.
export interface GuardSearch {
  count: number;
  results: GuardMatch[];
}

// The guards whose name holds the text, by name, one page of at most `limit`
// and how many match in all. Blank text lists the first guards. The text is
// sent only as the value of a filter, never in the address of anything else.
// The server's refusal or failure is thrown for the field to show.
async function search(
  text: string,
  limit: number = GUARD_SEARCH_LIMIT,
  options?: RequestInit,
): Promise<GuardSearch> {
  const typed = text.trim();
  const data = await contentguardsList(
    {
      ...(typed ? { name__icontains: typed } : {}),
      limit,
      ordering: ['name'],
      pulp_type__in: [...SEARCHABLE_TYPES],
      fields: ['pulp_href', 'prn', 'name'],
    },
    options,
  );
  const page = parseResponse(foundPageSchema, data);

  return {
    count: page.count,
    results: page.results.map(({ pulp_href, name }) => ({ pulp_href, name })),
  };
}

export const ContentGuardClient = { chunks, names, search };

// The kind of a content guard, read from its address
// (`.../contentguards/<app>/<kind>/<id>/`): "rbac", "x509", "header",
// "content_redirect" and so on. Null for an address that does not name a
// guard. Reading it costs no request, and the address is what the server
// builds from the guard's own type.
export function guardKindOf(href: string | null | undefined): string | null {
  const match = /\/contentguards\/[^/]+\/([^/]+)\/[^/]+\/?$/.exec(href ?? '');

  return match ? (match[1] as string) : null;
}
