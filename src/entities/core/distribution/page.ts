import {
  distributionsList,
  getDistributionsListUrl,
} from '@pulp-ui/sdk/core/distributions';
import { z } from 'zod';
import { ansibleDistribution } from 'src/entities/ansible/distribution';
import { chunkByUrl, runBounded } from 'src/entities/batch';
import { containerDistribution } from 'src/entities/container/distribution';
import { debDistribution } from 'src/entities/deb/distribution';
import { debPublication } from 'src/entities/deb/publication';
import { fileDistribution } from 'src/entities/file/distribution';
import { filePublication } from 'src/entities/file/publication';
import { pulpHrefSchema } from 'src/entities/href';
import { mavenDistribution } from 'src/entities/maven/distribution';
import { npmDistribution } from 'src/entities/npm/distribution';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import { type Page, pageSchemaOf } from 'src/entities/plugin/model';
import { type Options, toListRequest } from 'src/entities/plugin/request';
import { pythonDistribution } from 'src/entities/python/distribution';
import { parseResponse } from 'src/entities/response-shape';
import { rpmDistribution } from 'src/entities/rpm/distribution';
import { rpmPublication } from 'src/entities/rpm/publication';

// The distributions of every plugin through the one endpoint that lists them
// all, and what each plugin adds to a row of it.
//
// The core list holds a row for a distribution of any plugin, and for objects
// no plugin screen is about (the distribution Pulp keeps for an artifact). A
// row names neither its type nor where a client of its plugin reaches it, and
// its base URL is the content path, which is not the address a python or an
// ansible client uses. The type is read from the row's PRN (or its address),
// and the address of a client from the plugin's own read of the rows of a page,
// in groups, so a page costs one read of the list and a bounded number of
// reads of the plugins.

// The plugins that have distributions. For each: the `pulp_type` the list is
// filtered by, the model name its PRNs carry, and the path below
// `distributions/` of its own endpoint.
export const DISTRIBUTION_TYPES = {
  file: {
    pulpType: 'file.file',
    model: 'file.filedistribution',
    endpoint: 'file/file',
  },
  deb: {
    pulpType: 'deb.apt-distribution',
    model: 'deb.aptdistribution',
    endpoint: 'deb/apt',
  },
  rpm: {
    pulpType: 'rpm.rpm',
    model: 'rpm.rpmdistribution',
    endpoint: 'rpm/rpm',
  },
  python: {
    pulpType: 'python.python',
    model: 'python.pythondistribution',
    endpoint: 'python/pypi',
  },
  maven: {
    pulpType: 'maven.maven',
    model: 'maven.mavendistribution',
    endpoint: 'maven/maven',
  },
  npm: {
    pulpType: 'npm.npm',
    model: 'npm.npmdistribution',
    endpoint: 'npm/npm',
  },
  ansible: {
    pulpType: 'ansible.ansible',
    model: 'ansible.ansibledistribution',
    endpoint: 'ansible/ansible',
  },
  container: {
    pulpType: 'container.container',
    model: 'container.containerdistribution',
    endpoint: 'container/container',
  },
} as const;

export type DistributionPlugin = keyof typeof DISTRIBUTION_TYPES;

const PLUGINS = Object.keys(DISTRIBUTION_TYPES) as DistributionPlugin[];

// The plugins whose distributions serve from publications, with the entity that
// reads their publications. The others serve versions directly and have no
// publication to wait for.
export const PUBLICATION_ENTITIES = {
  file: filePublication,
  deb: debPublication,
  rpm: rpmPublication,
} as const;

export type PublicationPlugin = keyof typeof PUBLICATION_ENTITIES;

export function servesFromPublication(
  plugin: DistributionPlugin,
): plugin is PublicationPlugin {
  return plugin in PUBLICATION_ENTITIES;
}

// What the page of the list asks for: everything the cells of the list read,
// and the PRN that tells the type.
const PAGE_FIELDS = [
  'pulp_href',
  'prn',
  'name',
  'base_path',
  'base_url',
  'repository',
  'repository_version',
  'content_guard',
  'pulp_labels',
  'pulp_created',
  'hidden',
];

const coreDistributionSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  prn: z.string().nullish(),
  name: z.string(),
  base_path: z.string(),
  base_url: z.string().nullish(),
  repository: pulpHrefSchema.nullish(),
  repository_version: pulpHrefSchema.nullish(),
  content_guard: pulpHrefSchema.nullish(),
  pulp_labels: z.record(z.string(), z.string().nullable()).nullish(),
  pulp_created: z.string().nullish(),
  hidden: z.boolean().nullish(),
});

type CoreDistribution = z.infer<typeof coreDistributionSchema>;

// A row of the page: the row as the core list answers it, the plugin that owns
// it (null for a type no plugin screen knows) and the name of its type.
export interface ListedDistribution extends CoreDistribution {
  plugin: DistributionPlugin | null;
  typeName: string;
}

// The model name of a row's PRN (prn:<app>.<model>:<id>), lower case, or null
// when the row has no PRN of that shape.
function modelOfPrn(prn: string | null | undefined): string | null {
  const match = /^prn:([a-z0-9_.-]+):/i.exec(prn ?? '');

  return match ? (match[1] as string).toLowerCase() : null;
}

// The path below `distributions/` an address names ("file/file"), or null when
// the address is not the address of a distribution.
function endpointOfHref(href: string): string | null {
  const match = /\/distributions\/([^/]+\/[^/]+)\/[^/]+\/?(?:[?#].*)?$/.exec(
    href,
  );

  return match ? (match[1] as string) : null;
}

// The plugin that owns a distribution row, read from its PRN, or from its
// address when the row has no PRN; null for a row of any type no plugin
// screen is about. A PRN that names a model is final: the address is never
// asked then.
export function pluginOfDistribution(row: {
  pulp_href: string;
  prn?: string | null | undefined;
}): DistributionPlugin | null {
  const model = modelOfPrn(row.prn);
  if (model !== null) {
    return (
      PLUGINS.find((plugin) => DISTRIBUTION_TYPES[plugin].model === model) ??
      null
    );
  }
  const endpoint = endpointOfHref(row.pulp_href);

  return (
    PLUGINS.find(
      (plugin) => DISTRIBUTION_TYPES[plugin].endpoint === endpoint,
    ) ?? null
  );
}

// The name of a row's type for a row no plugin owns: the model of its PRN, the
// endpoint of its address, or "unknown".
export function distributionTypeName(row: {
  pulp_href: string;
  prn?: string | null | undefined;
}): string {
  return modelOfPrn(row.prn) ?? endpointOfHref(row.pulp_href) ?? 'unknown';
}

// Types that are in the core list and never a distribution a person made: the
// object Pulp keeps for an artifact and the one for a public key. They are
// never asked for, and a server that answers them anyway has them left out.
const NOT_SHOWN_MODELS = /^core\./;

// What a page of the list is asked for, in the terms of a screen.
export interface DistributionPageParams {
  // The plugins whose distributions are listed: the installed ones that have
  // distributions, or those of them the user chose. The list is limited to
  // their types. No plugin means no read.
  plugins: readonly DistributionPlugin[];
  page?: number;
  page_size?: number;
  sort?: string;
  // Text the name, or the base path, contains, ignoring case.
  name__icontains?: string;
  base_path__icontains?: string;
  // The expression the labels must satisfy.
  pulp_label_select?: string;
  // Only the distributions at these addresses. An empty set selects nothing,
  // and the server is not asked.
  pulp_href__in?: readonly string[];
}

// The filters of the list that are single text values.
const TEXT_FILTERS = [
  'name__icontains',
  'base_path__icontains',
  'pulp_label_select',
] as const;

const EMPTY: Page<never> = {
  count: 0,
  next: null,
  previous: null,
  results: [],
};

// The request a page of the list is read with.
function requestOf(params: DistributionPageParams) {
  const { pulp_href__in, ...rest } = params;

  return {
    ...toListRequest(
      {
        ...rest,
        sort: params.sort ?? 'name',
        ...(pulp_href__in ? { pulp_href__in: [...pulp_href__in] } : {}),
      },
      TEXT_FILTERS,
    ),
    pulp_type__in: params.plugins.map(
      (plugin) => DISTRIBUTION_TYPES[plugin].pulpType,
    ),
    fields: PAGE_FIELDS,
  } as Parameters<typeof distributionsList>[0];
}

// One page of the distributions of the given plugins, in the order asked for,
// each row with its plugin.
export async function distributionPage(
  params: DistributionPageParams,
  options?: Options,
): Promise<Page<ListedDistribution>> {
  if (params.plugins.length === 0 || params.pulp_href__in?.length === 0) {
    return EMPTY;
  }

  const data = await distributionsList(requestOf(params), options);
  const answer = parseResponse(pageSchemaOf(coreDistributionSchema), data);

  return {
    ...answer,
    results: answer.results.flatMap((row) => {
      const model = modelOfPrn(row.prn);
      if (model !== null && NOT_SHOWN_MODELS.test(model)) {
        return [];
      }
      return [
        {
          ...row,
          plugin: pluginOfDistribution(row),
          typeName: distributionTypeName(row),
        },
      ];
    }),
  };
}

// The filters of a page request apart from the ones that cut it into a page
// and order it, which is what the reads of a set of addresses share.
export type DistributionFilters = Omit<
  DistributionPageParams,
  'page' | 'page_size' | 'sort' | 'pulp_href__in'
>;

// How many distributions the server answers on one page at most.
const MOST_ON_A_PAGE = 1000;

// How many groups of addresses are read at once.
const CHUNK_READS_AT_ONCE = 4;

// Splits addresses into groups, each read by one request with the filters whose
// URL stays under the budget. Every address is kept once, in order.
export function distributionChunks(
  hrefs: readonly string[],
  filters: DistributionFilters,
): string[][] {
  return chunkByUrl(
    (group) =>
      getDistributionsListUrl(
        requestOf({
          ...filters,
          page_size: MOST_ON_A_PAGE,
          pulp_href__in: group,
        }),
      ),
    Array.from(new Set(hrefs)),
  );
}

// The distributions of the groups, one request for each (at most four at once)
// with the filters, each row once. The page, its size and the order are not
// used: the caller pages and orders what comes back.
export async function readDistributionChunks(
  chunks: readonly (readonly string[])[],
  filters: DistributionFilters,
  options?: Options,
): Promise<ListedDistribution[]> {
  const pages = await runBounded(chunks, CHUNK_READS_AT_ONCE, (chunk) =>
    distributionPage(
      {
        ...filters,
        page: 1,
        page_size: Math.max(chunk.length, 1),
        pulp_href__in: chunk,
      },
      options,
    ),
  );
  // A row at an address that was not asked for is dropped, so a server that
  // ignores the filter cannot put another distribution on screen.
  const asked = new Set(chunks.flat());
  const byHref = new Map<string, ListedDistribution>();
  for (const page of pages) {
    for (const row of page.results) {
      if (asked.has(row.pulp_href)) {
        byHref.set(row.pulp_href, row);
      }
    }
  }

  return Array.from(byHref.values());
}

// What a plugin's own read of a distribution adds to the row of the core list:
// where a client of the plugin reaches it, the publication it is bound to (the
// core row names none) and whether it serves by checkpoint.
export interface DistributionFacts {
  url: string | null;
  publication: string | null;
  checkpoint: boolean;
}

// How a plugin's own entity is read for the addresses of the rows of a page.
interface FactsReader {
  chunks: (hrefs: readonly string[]) => string[][];
  // Each address with what the plugin's own row says of it.
  read: (
    hrefs: readonly string[],
    options?: Options,
  ) => Promise<[string, DistributionFacts][]>;
}

function readerOf<Row extends DistributionBase>(entity: {
  chunks: (hrefs: readonly string[]) => string[][];
  ofHrefs: (hrefs: readonly string[], options?: Options) => Promise<Row[]>;
  clientUrlOf: (row: Row) => string | null;
}): FactsReader {
  return {
    chunks: (hrefs) => entity.chunks(hrefs),
    read: async (hrefs, options) =>
      (await entity.ofHrefs(hrefs, options)).map((row) => [
        row.pulp_href,
        {
          url: entity.clientUrlOf(row),
          publication: row.publication ?? null,
          checkpoint: row.checkpoint === true,
        },
      ]),
  };
}

const READERS: Record<DistributionPlugin, FactsReader> = {
  file: readerOf(fileDistribution),
  deb: readerOf(debDistribution),
  rpm: readerOf(rpmDistribution),
  python: readerOf(pythonDistribution),
  maven: readerOf(mavenDistribution),
  npm: readerOf(npmDistribution),
  ansible: readerOf(ansibleDistribution),
  container: readerOf(containerDistribution),
};

// The distribution entity of each plugin, for the writes of a row: a plugin's
// own entity deletes the distribution at an address of the plugin.
export const DISTRIBUTION_ENTITIES = {
  file: fileDistribution,
  deb: debDistribution,
  rpm: rpmDistribution,
  python: pythonDistribution,
  maven: mavenDistribution,
  npm: npmDistribution,
  ansible: ansibleDistribution,
  container: containerDistribution,
} as const satisfies Record<DistributionPlugin, unknown>;

// One read of a plugin's own list: the addresses of some rows of one plugin,
// few enough for one request.
export interface EnrichmentChunk {
  plugin: DistributionPlugin;
  hrefs: string[];
}

// The reads that tell where each row of a page is reached and what it is bound
// to: the rows grouped by
// plugin, each group cut so that no request is longer than the URL budget. A
// row no plugin owns is left out, and every other row is in exactly one chunk.
export function enrichmentChunks(
  rows: readonly Pick<ListedDistribution, 'plugin' | 'pulp_href'>[],
): EnrichmentChunk[] {
  return PLUGINS.flatMap((plugin) => {
    const hrefs = rows
      .filter((row) => row.plugin === plugin)
      .map((row) => row.pulp_href);

    return READERS[plugin]
      .chunks(hrefs)
      .map((group) => ({ plugin, hrefs: group }));
  });
}

// Reads one chunk: each address in it with what the plugin's own row says: the
// address a client reaches the distribution at (null when the row names none),
// the publication it is bound to and whether it serves by checkpoint.
export function readEnrichment(
  { plugin, hrefs }: EnrichmentChunk,
  options?: Options,
): Promise<[string, DistributionFacts][]> {
  return READERS[plugin].read(hrefs, options);
}
