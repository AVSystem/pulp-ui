import type { ZodType } from 'zod';
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
  taskResponseSchema,
  versionPageSchema,
  versionSchema,
} from './model';

// One factory builds the repository entity of every plugin from the plugin's
// own generated functions, so the plugins differ in the functions and the
// schema they pass and nowhere else. The factory is typed by its parameters
// and imports no generated module: only the wiring of a plugin does.
//
// Every function takes the options of `fetch` last, so an abort signal
// cancels the request, and every answer goes through a schema: an answer that
// does not have the shape the screens read is a ResponseShapeError.

type Options = RequestInit | undefined;

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

// What an update answers with: the address of the task the server started, or
// the repository when it finished the change at once.
export type UpdateResult<Row> =
  { kind: 'task'; task: string } | { kind: 'done'; repository: Row };

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
  // The versions of the repository at this address.
  versions: (
    href: string,
    params?: VersionListParams,
    options?: Options,
  ) => Promise<Page<RepositoryVersion>>;
  version: (href: string, options?: Options) => Promise<RepositoryVersion>;
  // Starts a sync or a content change; resolves with the address of the task.
  sync?: (href: string, body: TSync, options?: Options) => Promise<string>;
  modify?: (href: string, body: TModify, options?: Options) => Promise<string>;
}

const TEXT_FILTERS = [
  'name',
  'name__contains',
  'name__icontains',
  'pulp_label_select',
  'remote',
] as const;

const LIST_FILTERS = ['name__in', 'pulp_href__in', 'fields'] as const;

// The filters whose empty set means that nothing matches. A server reads an
// empty set as no filter and would answer every repository.
const MATCHING_FILTERS = ['name__in', 'pulp_href__in'] as const;

// The parameters of the generated client are typed per plugin, down to the
// enumeration of the columns it sorts by; the entity builds them from the
// terms of a screen and the server rejects what it does not know.
function asParams<T>(request: Record<string, unknown>): T {
  return request as unknown as T;
}

// Turns the page, size, sort and filters of a screen into what the server
// takes: an offset, a limit, an ordering and the filter keys. A filter that is
// not set is not sent.
function toRequestParams(
  params: RepositoryListParams,
): Record<string, unknown> {
  const limit = positiveInt(params.page_size, DEFAULT_PAGE_SIZE);
  const page = positiveInt(params.page, 1);
  const request: Record<string, unknown> = {
    offset: (page - 1) * limit,
    limit,
  };

  if (params.sort) {
    request.ordering = [params.sort];
  }
  for (const key of TEXT_FILTERS) {
    if (params[key]) {
      request[key] = params[key];
    }
  }
  for (const key of LIST_FILTERS) {
    const values = params[key];
    if (values && values.length > 0) {
      request[key] = values;
    }
  }

  return request;
}

// Whether the parameters ask for rows out of an empty set of values.
function matchesNothing(params: RepositoryListParams): boolean {
  return MATCHING_FILTERS.some((key) => params[key]?.length === 0);
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
      return { count: 0, next: null, previous: null, results: [] };
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

  async function update(
    href: string,
    body: TUpdate,
    options?: Options,
  ): Promise<UpdateResult<Row>> {
    const data = await api.partialUpdate(href, body, options);
    if (typeof data === 'object' && data !== null && 'task' in data) {
      return {
        kind: 'task',
        task: parseResponse(taskResponseSchema, data).task,
      };
    }
    return { kind: 'done', repository: parseResponse(schema, data) };
  }

  async function taskOf(request: Promise<unknown>): Promise<string> {
    return parseResponse(taskResponseSchema, await request).task;
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
    update,
    remove: (href, options) => taskOf(api.remove(href, options)),
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
    versions: async (href, params = {}, options) =>
      parseResponse(
        versionPageSchema,
        await api.versionsList(
          href,
          asParams<TVersionParams>(toVersionParams(params)),
          options,
        ),
      ) as Page<RepositoryVersion>,
    version: async (href, options) =>
      parseResponse(
        versionSchema,
        await api.versionRead(href, undefined, options),
      ),
  };

  const { sync, modify } = api;
  if (sync) {
    entity.sync = (href, body, options) => taskOf(sync(href, body, options));
  }
  if (modify) {
    entity.modify = (href, body, options) =>
      taskOf(modify(href, body, options));
  }

  return entity;
}
