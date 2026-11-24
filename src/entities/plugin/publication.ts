import { useCallback } from 'react';
import { type ZodType, z } from 'zod';
import { chunkByUrl } from 'src/entities/batch';
import {
  pulpHrefSchema,
  repositoryOfVersion,
  versionNumberOf,
} from 'src/entities/href';
import { parseResponse } from 'src/entities/response-shape';
import { useSessionQuery } from 'src/query/use-session-query';
import { type Page, pageSchemaOf } from './model';
import { entityKeys } from './queries';
import { type Options, asParams, taskOf, toListRequest } from './request';

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

// The fields a page of the index asks for: the three above and the creation
// time.
export const PUBLICATION_INDEX_PAGE_FIELDS = [
  ...PUBLICATION_INDEX_FIELDS,
  'pulp_created',
] as const;

// How many publications one request of the index reads: the most the server
// answers on one page.
const INDEX_PAGE_SIZE = 1000;

// How many pages of the index are read: 10,000 publications of one plugin. A
// plugin with more has publications the index does not hold, so it cannot say
// that a repository has none or which is the newest.
export const PUBLICATION_INDEX_PAGES = 10;

// How long the index is taken as current.
const INDEX_STALE_MS = 60_000;

// What a list of publications is asked for, in the terms of a screen.
export interface PublicationListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  pulp_href__in?: string[];
  // the address of a repository: only the publications made from it
  repository?: string;
  fields?: string[];
}

// How many publications one request of a repository's publications reads: the
// most the server answers on one page.
const OF_REPOSITORY_PAGE_SIZE = 1000;

// What a publish request sends: exactly one of the repository (its latest
// version is published) or one repository version, and the options the plugin's
// descriptor declares under the names the plugin's own request uses.
export type PublishBody = {
  repository?: string;
  repository_version?: string;
} & Record<string, unknown>;

// What a plugin's generated client offers for its publications. A plugin that
// cannot publish from the screens has no `create`.
export interface PublicationApi<TListParams, TCreate = unknown> {
  list: (params?: TListParams, options?: Options) => Promise<unknown>;
  create?: (body: TCreate, options?: Options) => Promise<unknown>;
  // Deletes a publication; the server answers 204 and starts no task.
  remove?: (href: string, options?: Options) => Promise<unknown>;
  // The address a list with these parameters is requested from, as the client
  // builds it; chunkByUrl measures requests on it.
  listUrl: (params?: TListParams) => string;
}

// What the publications of a plugin say about which repository versions are
// published, for the rules that decide what a distribution serves.
export interface PublicationIndex {
  // More publications exist than the index reads, so what it says about a
  // repository having none, or about its newest published version, may be
  // wrong.
  overBound: boolean;
  // The highest version number of the repository that has a publication, or
  // null when none is known. The publication that was made last does not
  // count: a distribution bound to a repository serves the highest version.
  newestPublishedVersion: (repository: string) => number | null;
  // Whether this exact repository version has a publication.
  versionHasPublication: (version: string | null | undefined) => boolean;
}

// The index of the publications that were read, and whether more exist.
export function publicationIndexOf(
  rows: readonly PublicationBase[],
  overBound: boolean,
): PublicationIndex {
  const newest = new Map<string, number>();
  const versions = new Set<string>();

  for (const row of rows) {
    if (row.repository_version) {
      versions.add(row.repository_version);
    }
    const repository = repositoryOfPublication(row);
    const number = versionNumberOf(row.repository_version);
    if (repository !== null && number !== null) {
      newest.set(repository, Math.max(newest.get(repository) ?? 0, number));
    }
  }

  return {
    overBound,
    newestPublishedVersion: (repository) => newest.get(repository) ?? null,
    versionHasPublication: (version) => !!version && versions.has(version),
  };
}

export interface PublicationEntity<Row> {
  readonly app: string;
  readonly object: 'publication';
  // Starts a publish; resolves with the address of the task that does it. A
  // plugin that cannot publish from the screens has none.
  create?: (body: PublishBody, options?: Options) => Promise<string>;
  // Deletes a publication at once: the server answers 204 and starts no task,
  // so there is nothing to wait for. A plugin that cannot delete from the
  // screens has none.
  remove?: (href: string, options?: Options) => Promise<void>;
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
  // Every publication made from a repository, read page after page. It ends
  // when the server names no next page or a page comes back empty. The server's
  // filter is not trusted: a publication that names another repository is left
  // out.
  ofRepository: (repository: string, options?: Options) => Promise<Row[]>;
  // The index of the plugin's publications, read page after page of 1,000 up
  // to PUBLICATION_INDEX_PAGES pages. Past the bound it stops and says so. A
  // failed page rejects: part of the publications is never taken for all.
  index: (options?: Options) => Promise<PublicationIndex>;
}

export function makePublicationEntity<
  Row extends PublicationBase,
  TListParams,
  TCreate = unknown,
>({
  app,
  schema,
  api,
}: {
  app: string;
  schema: ZodType<Row>;
  api: PublicationApi<TListParams, TCreate>;
}): PublicationEntity<Row> {
  const pageSchema = pageSchemaOf(schema);

  const requestOf = (params: PublicationListParams) =>
    asParams<TListParams>(toListRequest(params, ['repository']));
  // The request that reads the publications at some addresses on one page.
  const ofHrefsRequest = (hrefs: readonly string[]) =>
    requestOf({
      pulp_href__in: [...hrefs],
      page_size: Math.max(hrefs.length, 1),
      fields: [...PUBLICATION_INDEX_FIELDS],
    });

  const { create, remove } = api;

  return {
    app,
    object: 'publication',
    ...(create
      ? {
          create: async (body: PublishBody, options?: Options) =>
            taskOf(await create(body as TCreate, options)),
        }
      : {}),
    ...(remove
      ? {
          remove: async (href: string, options?: Options) => {
            await remove(href, options);
          },
        }
      : {}),
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
    ofRepository: async (repository, options) => {
      const byHref = new Map<string, Row>();
      let received = 0;

      for (;;) {
        const data = await api.list(
          asParams<TListParams>({
            offset: received,
            limit: OF_REPOSITORY_PAGE_SIZE,
            repository,
            fields: [...PUBLICATION_INDEX_PAGE_FIELDS],
          }),
          options,
        );
        const next = parseResponse(pageSchema, data) as Page<Row>;
        for (const row of next.results) {
          if (repositoryOfPublication(row) === repository) {
            byHref.set(row.pulp_href, row);
          }
        }
        received += next.results.length;
        if (!next.next || next.results.length === 0) {
          return Array.from(byHref.values());
        }
      }
    },
    index: async (options) => {
      const byHref = new Map<string, Row>();
      let received = 0;

      for (let read = 0; read < PUBLICATION_INDEX_PAGES; read++) {
        const data = await api.list(
          asParams<TListParams>({
            offset: received,
            limit: INDEX_PAGE_SIZE,
            fields: [...PUBLICATION_INDEX_PAGE_FIELDS],
          }),
          options,
        );
        const next = parseResponse(pageSchema, data) as Page<Row>;
        for (const row of next.results) {
          byHref.set(row.pulp_href, row);
        }
        received += next.results.length;
        if (!next.next || next.results.length === 0) {
          return publicationIndexOf(Array.from(byHref.values()), false);
        }
      }

      return publicationIndexOf(Array.from(byHref.values()), true);
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
    // Every publication made from one repository.
    ofRepository: (repository: string) =>
      [...all, 'of-repository', repository] as const,
  };
}

// How long the publications of one repository are taken as current.
const OF_REPOSITORY_STALE_MS = 30_000;

// Every publication made from one repository, read once for every screen that
// asks and cached. It shares its entry with the screens that find out what the
// distributions of the repository serve. It sends nothing while `enabled` is
// false.
export function useRepositoryPublications<Row extends PublicationBase>(
  entity: Pick<PublicationEntity<Row>, 'app' | 'object' | 'ofRepository'>,
  repository: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: publicationKeys(entity).ofRepository(repository),
    queryFn: ({ signal }) => entity.ofRepository(repository, { signal }),
    staleTime: OF_REPOSITORY_STALE_MS,
    enabled,
  });
}

export type PublicationIndexStatus = 'idle' | 'pending' | 'ready' | 'error';

export interface PublicationIndexRead {
  status: PublicationIndexStatus;
  error: unknown;
  // Undefined until the index is read.
  index: PublicationIndex | undefined;
  // Reads again a read that failed.
  retry: () => void;
}

// The index of one plugin's publications, shared by every screen that needs it
// and read once for all of them, cached for a minute. It sends nothing while
// `enabled` is false.
export function usePublicationIndex(
  entity: {
    readonly app: string;
    readonly object: 'publication';
    index: (options?: Options) => Promise<PublicationIndex>;
  },
  { enabled }: { enabled: boolean },
): PublicationIndexRead {
  const read = useSessionQuery({
    queryKey: entityKeys(entity).index,
    queryFn: ({ signal }) => entity.index({ signal }),
    staleTime: INDEX_STALE_MS,
    enabled,
  });
  const { refetch } = read;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    status: read.data
      ? 'ready'
      : read.status === 'error'
        ? 'error'
        : enabled
          ? 'pending'
          : 'idle',
    error: read.error,
    index: read.data,
    retry,
  };
}

export { publicationSchema };
export type { PublicationBase };
