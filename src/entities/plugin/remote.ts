import type { ZodType } from 'zod';
import { parseResponse } from 'src/entities/response-shape';
import {
  type EntityListParams,
  type Page,
  type RemoteBase,
  labelResponseSchema,
  pageSchemaOf,
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

// The remote entity of every plugin, built from the plugin's own generated
// functions the way the repository entity is. A remote has no versions and
// nothing to sync from, so it has less: list, lookup by name, read, create,
// update, delete and labels.

// What a plugin's generated client offers for its remotes.
export interface RemoteApi<TListParams, TCreate, TUpdate> {
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
}

export interface RemoteEntity<Row, TCreate, TUpdate> {
  // The plugin and the object, which key every cached read:
  // ['pulp', app, object, ...].
  readonly app: string;
  readonly object: 'remote';
  list: (params?: EntityListParams, options?: Options) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params?: EntityListParams) => string;
  // The remote with this exact name, or null. A name that came from the
  // address bar reaches the server only as the value of the name filter.
  byName: (name: string, options?: Options) => Promise<Row | null>;
  retrieve: (href: string, options?: Options) => Promise<Row>;
  create: (body: TCreate, options?: Options) => Promise<Row>;
  // Sends the given fields only; a field not given is left as it is.
  update: (
    href: string,
    body: TUpdate,
    options?: Options,
  ) => Promise<UpdateResult<Row>>;
  // Deletes a remote; resolves with the address of the task that does it.
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
}

export function makeRemoteEntity<
  Row extends RemoteBase,
  TListParams,
  TCreate,
  TUpdate,
>({
  app,
  schema,
  api,
}: {
  app: string;
  schema: ZodType<Row>;
  api: RemoteApi<TListParams, TCreate, TUpdate>;
}): RemoteEntity<Row, TCreate, TUpdate> {
  const pageSchema = pageSchemaOf(schema);

  async function list(
    params: EntityListParams = {},
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
    // remote.
    if (name === '') {
      return null;
    }
    const data = await api.list(
      asParams<TListParams>({ name, limit: 1 }),
      options,
    );
    const found = (parseResponse(pageSchema, data) as Page<Row>).results[0];
    // The name is unique, so a row of another name means the filter was not
    // applied; it is not this remote.
    return found && found.name === name ? found : null;
  }

  return {
    app,
    object: 'remote',
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
  };
}
