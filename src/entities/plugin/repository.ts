import type { ZodType } from 'zod';
import { chunkByUrl, runBounded } from 'src/entities/batch';
import { positiveInt } from 'src/entities/page-params';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type Page,
  type RepositoryBase,
  type RepositoryListParams,
  type RepositoryVersion,
  type VersionListParams,
  labelResponseSchema,
  pageSchemaOf,
  versionPageSchema,
  versionSchema,
} from './model';
import {
  EMPTY_PAGE,
  type Options,
  type UpdateResult,
  asParams,
  matchesNothing,
  parseUpdate,
  taskOf,
  toRequestParams,
} from './request';

// One factory builds the repository entity of every plugin from the plugin's
// own generated functions, so the plugins differ in the functions and the
// schema they pass and nowhere else. The factory is typed by its parameters
// and imports no generated module: only the wiring of a plugin does.
//
// The fields the index of every repository asks for: what a filter needs to
// suggest label keys and to match remotes, and nothing else.
export const REPOSITORY_INDEX_FIELDS = [
  'pulp_href',
  'name',
  'remote',
  'pulp_labels',
] as const;

// How many repositories one request of the index reads: the most the server
// answers on one page.
const INDEX_PAGE_SIZE = 1000;

// How many chunk reads of one request set are in flight at once.
const CHUNK_READS_AT_ONCE = 4;

// Every function takes the options of `fetch` last, so an abort signal
// cancels the request, and every answer goes through a schema: an answer that
// does not have the shape the screens read is a ResponseShapeError.

// What a plugin's generated client offers for its repositories. The sync and
// modify requests exist only for plugins that have them.
export interface RepositoryApi<
  TListParams,
  TCreate,
  TUpdate,
  TVersionParams,
  TSync,
  TModify,
> {
  list: (params?: TListParams, options?: Options) => Promise<unknown>;
  // The address a list with these parameters is requested from, as the client
  // builds it; chunkByUrl measures requests on it.
  listUrl: (params?: TListParams) => string;
  read: (
    href: string,
    params?: undefined,
    options?: Options,
  ) => Promise<unknown>;
  create: (body: TCreate, options?: Options) => Promise<unknown>;
  partialUpdate: (
    href: string,
    body: TUpdate,
    options?: Options,
  ) => Promise<unknown>;
  remove: (href: string, options?: Options) => Promise<unknown>;
  setLabel: (
    href: string,
    body: { key: string; value: string | null },
    options?: Options,
  ) => Promise<unknown>;
  unsetLabel: (
    href: string,
    body: { key: string },
    options?: Options,
  ) => Promise<unknown>;
  versionsList: (
    href: string,
    params?: TVersionParams,
    options?: Options,
  ) => Promise<unknown>;
  versionRead: (
    href: string,
    params?: undefined,
    options?: Options,
  ) => Promise<unknown>;
  sync?: (href: string, body: TSync, options?: Options) => Promise<unknown>;
  modify?: (href: string, body: TModify, options?: Options) => Promise<unknown>;
}

export interface RepositoryEntity<Row, TCreate, TUpdate, TSync, TModify> {
  // The plugin (file, deb, rpm, python, ...) and the object, which key every
  // cached read: ['pulp', app, object, ...].
  readonly app: string;
  readonly object: 'repository';
  list: (
    params?: RepositoryListParams,
    options?: Options,
  ) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params?: RepositoryListParams) => string;
  // The repository with this exact name, or null. A name that came from the
  // address bar reaches the server only as the value of the name filter.
  byName: (name: string, options?: Options) => Promise<Row | null>;
  retrieve: (href: string, options?: Options) => Promise<Row>;
  create: (body: TCreate, options?: Options) => Promise<Row>;
  update: (
    href: string,
    body: TUpdate,
    options?: Options,
  ) => Promise<UpdateResult<Row>>;
  // Deletes a repository; resolves with the address of the task that does it.
  remove: (href: string, options?: Options) => Promise<string>;
  setLabel: (
    href: string,
    label: { key: string; value: string | null },
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
  unsetLabel: (
    href: string,
    key: string,
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
  // Every repository of the plugin with the fields of REPOSITORY_INDEX_FIELDS,
  // read page after page. It ends when the server names no next page or a page
  // comes back empty, so a list that shrank while it was read never loops. A
  // row that shows on two pages because the list changed in between is kept
  // once.
  index: (options?: Options) => Promise<Row[]>;
  // The addresses split into groups that each fit one request together with
  // the other filters of `params`; no request line is longer than the budget.
  chunks: (
    hrefs: readonly string[],
    params?: RepositoryListParams,
  ) => string[][];
  // The repositories of the chunks, one request per chunk (at most four at
  // once) with the other filters of `params`, each repository once. The page,
  // page size and order of `params` are not used: the caller pages the result.
  readChunks: (
    chunks: readonly (readonly string[])[],
    params?: RepositoryListParams,
    options?: Options,
  ) => Promise<Row[]>;
  // The versions of the repository at this address.
  versions: (
    href: string,
    params?: VersionListParams,
    options?: Options,
  ) => Promise<Page<RepositoryVersion>>;
  version: (href: string, options?: Options) => Promise<RepositoryVersion>;
  // The version of the repository at this address that has this number, or null
  // when it has none. The number reaches the server only as the value of the
  // number filter, so no address is ever built from it; a number that cannot be
  // a version number (negative, fractional, past the safe integers) names
  // nothing and sends no request.
  versionByNumber: (
    href: string,
    number: number,
    options?: Options,
  ) => Promise<RepositoryVersion | null>;
  // Starts a sync or a content change; resolves with the address of the task.
  sync?: (href: string, body: TSync, options?: Options) => Promise<string>;
  modify?: (href: string, body: TModify, options?: Options) => Promise<string>;
}

function toVersionParams(params: VersionListParams): Record<string, unknown> {
  const limit = positiveInt(params.page_size, DEFAULT_PAGE_SIZE);
  const page = positiveInt(params.page, 1);
  const request: Record<string, unknown> = {
    offset: (page - 1) * limit,
    limit,
  };

  if (params.sort) {
    request.ordering = [params.sort];
  }
  if (params.number !== undefined) {
    request.number = params.number;
  }

  return request;
}

export type { UpdateResult };

export function makeRepositoryEntity<
  Row extends RepositoryBase,
  TListParams,
  TCreate,
  TUpdate,
  TVersionParams,
  TSync = never,
  TModify = never,
>({
  app,
  schema,
  api,
}: {
  app: string;
  schema: ZodType<Row>;
  api: RepositoryApi<
    TListParams,
    TCreate,
    TUpdate,
    TVersionParams,
    TSync,
    TModify
  >;
}): RepositoryEntity<Row, TCreate, TUpdate, TSync, TModify> {
  const pageSchema = pageSchemaOf(schema);

  async function list(
    params: RepositoryListParams = {},
    options?: Options,
  ): Promise<Page<Row>> {
    if (matchesNothing(params)) {
      return EMPTY_PAGE;
    }
    const data = await api.list(
      asParams<TListParams>(toRequestParams(params)),
      options,
    );
    return parseResponse(pageSchema, data) as Page<Row>;
  }

  async function byName(name: string, options?: Options): Promise<Row | null> {
    // An empty filter value is no filter: the server would answer its first
    // repository.
    if (name === '') {
      return null;
    }
    const data = await api.list(
      asParams<TListParams>({ name, limit: 1 }),
      options,
    );
    const found = (parseResponse(pageSchema, data) as Page<Row>).results[0];
    // The name is unique, so a row of another name means the filter was not
    // applied; it is not this repository.
    return found && found.name === name ? found : null;
  }

  async function versions(
    href: string,
    params: VersionListParams = {},
    options?: Options,
  ): Promise<Page<RepositoryVersion>> {
    return parseResponse(
      versionPageSchema,
      await api.versionsList(
        href,
        asParams<TVersionParams>(toVersionParams(params)),
        options,
      ),
    ) as Page<RepositoryVersion>;
  }

  const entity: RepositoryEntity<Row, TCreate, TUpdate, TSync, TModify> = {
    app,
    object: 'repository',
    list,
    urlOf: (params = {}) =>
      api.listUrl(asParams<TListParams>(toRequestParams(params))),
    byName,
    retrieve: async (href, options) =>
      parseResponse(schema, await api.read(href, undefined, options)),
    create: async (body, options) =>
      parseResponse(schema, await api.create(body, options)),
    update: async (href, body, options) =>
      parseUpdate(schema, await api.partialUpdate(href, body, options)),
    remove: async (href, options) => taskOf(await api.remove(href, options)),
    setLabel: async (href, label, options) =>
      parseResponse(
        labelResponseSchema,
        await api.setLabel(href, label, options),
      ),
    unsetLabel: async (href, key, options) =>
      parseResponse(
        labelResponseSchema,
        await api.unsetLabel(href, { key }, options),
      ),
    index: async (options) => {
      const byHref = new Map<string, Row>();
      let received = 0;

      for (;;) {
        const data = await api.list(
          asParams<TListParams>({
            offset: received,
            limit: INDEX_PAGE_SIZE,
            fields: [...REPOSITORY_INDEX_FIELDS],
          }),
          options,
        );
        const next = parseResponse(pageSchema, data) as Page<Row>;
        for (const row of next.results) {
          byHref.set(row.pulp_href, row);
        }
        received += next.results.length;
        if (!next.next || next.results.length === 0) {
          return Array.from(byHref.values());
        }
      }
    },
    chunks: (hrefs, params = {}) =>
      chunkByUrl(
        (values) =>
          api.listUrl(
            asParams<TListParams>(
              toRequestParams({ ...params, pulp_href__in: values }),
            ),
          ),
        hrefs,
      ),
    readChunks: async (chunks, params = {}, options) => {
      const pages = await runBounded(chunks, CHUNK_READS_AT_ONCE, (chunk) =>
        list(
          {
            ...params,
            page: 1,
            page_size: chunk.length,
            sort: undefined,
            pulp_href__in: [...chunk],
          },
          options,
        ),
      );
      const byHref = new Map<string, Row>();
      for (const page of pages) {
        for (const row of page.results) {
          byHref.set(row.pulp_href, row);
        }
      }
      return Array.from(byHref.values());
    },
    versions,
    version: async (href, options) =>
      parseResponse(
        versionSchema,
        await api.versionRead(href, undefined, options),
      ),
    versionByNumber: async (href, number, options) => {
      if (!Number.isSafeInteger(number) || number < 0) {
        return null;
      }
      const found = (await versions(href, { number, page_size: 1 }, options))
        .results[0];
      // A row of another number means the filter was not applied; it is not
      // the version asked for.
      return found && found.number === number ? found : null;
    },
  };

  const { sync, modify } = api;
  if (sync) {
    entity.sync = async (href, body, options) =>
      taskOf(await sync(href, body, options));
  }
  if (modify) {
    entity.modify = async (href, body, options) =>
      taskOf(await modify(href, body, options));
  }

  return entity;
}
