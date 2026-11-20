import { type ZodType, z } from 'zod';
import { chunkByUrl } from 'src/entities/batch';
import { pulpHrefSchema, repositoryOfVersion } from 'src/entities/href';
import { parseResponse } from 'src/entities/response-shape';
import { type Page, pageSchemaOf } from './model';
import { entityKeys } from './queries';
import { type Options, asParams, toListRequest } from './request';

// The publication entity of a plugin that serves content from publications
// (file, deb, rpm). A plugin whose distributions serve a repository directly
// has none, and the screens that read distributions go without it.
//
// What a screen reads of a publication is where it came from: the repository
// and the repository version. An unnamed field is kept as it came and every
// address is a same-origin path.
const publicationSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  repository: pulpHrefSchema.nullish(),
  repository_version: pulpHrefSchema.nullish(),
  pulp_created: z.string().nullish(),
});

type PublicationBase = z.infer<typeof publicationSchema>;

// The fields a read of publications for the distribution index asks for.
export const PUBLICATION_INDEX_FIELDS = [
  'pulp_href',
  'repository',
  'repository_version',
] as const;

// What a list of publications is asked for, in the terms of a screen.
export interface PublicationListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  pulp_href__in?: string[];
  fields?: string[];
}

// What a plugin's generated client offers for its publications.
export interface PublicationApi<TListParams> {
  list: (params?: TListParams, options?: Options) => Promise<unknown>;
  // The address a list with these parameters is requested from, as the client
  // builds it; chunkByUrl measures requests on it.
  listUrl: (params?: TListParams) => string;
}

export interface PublicationEntity<Row> {
  readonly app: string;
  readonly object: 'publication';
  list: (
    params?: PublicationListParams,
    options?: Options,
  ) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params?: PublicationListParams) => string;
  // Splits publication addresses into groups, each read by one request whose
  // URL stays under the budget. Every address is kept once, in order.
  chunks: (hrefs: readonly string[]) => string[][];
  // The publications at these addresses, read with one request. The group
  // should come from `chunks`; an empty group sends nothing.
  ofHrefs: (hrefs: readonly string[], options?: Options) => Promise<Row[]>;
}

export function makePublicationEntity<
  Row extends PublicationBase,
  TListParams,
>({
  app,
  schema,
  api,
}: {
  app: string;
  schema: ZodType<Row>;
  api: PublicationApi<TListParams>;
}): PublicationEntity<Row> {
  const pageSchema = pageSchemaOf(schema);

  const requestOf = (params: PublicationListParams) =>
    asParams<TListParams>(toListRequest(params, []));
  // The request that reads the publications at some addresses on one page.
  const ofHrefsRequest = (hrefs: readonly string[]) =>
    requestOf({
      pulp_href__in: [...hrefs],
      page_size: Math.max(hrefs.length, 1),
      fields: [...PUBLICATION_INDEX_FIELDS],
    });

  return {
    app,
    object: 'publication',
    list: async (params = {}, options) => {
      if (params.pulp_href__in?.length === 0) {
        return { count: 0, next: null, previous: null, results: [] };
      }
      const data = await api.list(requestOf(params), options);
      return parseResponse(pageSchema, data) as Page<Row>;
    },
    urlOf: (params = {}) => api.listUrl(requestOf(params)),
    chunks: (hrefs) =>
      chunkByUrl(
        (group) => api.listUrl(ofHrefsRequest(group)),
        Array.from(new Set(hrefs)),
      ),
    ofHrefs: async (hrefs, options) => {
      if (hrefs.length === 0) {
        return [];
      }
      const data = await api.list(ofHrefsRequest(hrefs), options);
      return (parseResponse(pageSchema, data) as Page<Row>).results;
    },
  };
}

// The repository a publication was made from: the one its version belongs to,
// or the repository it names when the version address is not readable. Null
// when it names neither.
export function repositoryOfPublication(
  publication: PublicationBase,
): string | null {
  return (
    repositoryOfVersion(publication.repository_version) ??
    publication.repository ??
    null
  );
}

// The cache keys of a plugin's publication reads.
export function publicationKeys(entity: { app: string; object: string }) {
  const all = entityKeys(entity).all;

  return {
    all,
    // One group of addresses, read with one request; a publication never
    // changes the repository it came from.
    chunk: (hrefs: readonly string[]) => [...all, 'chunk', hrefs] as const,
  };
}

export { publicationSchema };
export type { PublicationBase };
