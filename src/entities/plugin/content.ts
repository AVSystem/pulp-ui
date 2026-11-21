import type { ZodType } from 'zod';
import { parseResponse } from 'src/entities/response-shape';
import { type Page, pageSchemaOf } from './model';
import { type Options, asParams, toListRequest } from './request';

// The content entity of a plugin: one kind of content (rpm packages, python
// packages) as the Packages tab of a repository reads it. It lists the content
// of one repository version and nothing else: the list of a content type
// without a version filter would be every package on the server.

// What a list of content is asked for, in the terms of a screen. The version is
// required, because that is what keeps a list to one repository; the other
// filters are the plugin's own text filters.
export interface ContentListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  // the address of the repository version whose content is listed
  repository_version: string;
  // the fields the answer is cut to
  fields?: string[];
  [filter: string]: string | number | string[] | undefined;
}

// What a plugin's generated client offers for one kind of content.
export interface ContentApi<TListParams> {
  list: (params?: TListParams, options?: Options) => Promise<unknown>;
  // The address a list with these parameters is requested from, as the client
  // builds it.
  listUrl: (params?: TListParams) => string;
}

export interface ContentEntity<Row> {
  readonly app: string;
  readonly object: string;
  list: (params: ContentListParams, options?: Options) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params: ContentListParams) => string;
}

// Builds the content entity of a plugin from its generated functions. The
// parameters a screen names are turned into what the server takes: an offset
// and a limit, an ordering and the text filters named here.
export function makeContentEntity<Row, TListParams>({
  app,
  object,
  schema,
  textFilters,
  api,
}: {
  app: string;
  // The name of the content type in the cache: 'package'.
  object: string;
  schema: ZodType<Row>;
  // The single-value filters the content type has besides the version.
  textFilters: readonly string[];
  api: ContentApi<TListParams>;
}): ContentEntity<Row> {
  const pageSchema = pageSchemaOf(schema);

  const requestOf = (params: ContentListParams) =>
    asParams<TListParams>({
      ...toListRequest(params, textFilters),
      repository_version: params.repository_version,
    });

  return {
    app,
    object,
    list: async (params, options) =>
      parseResponse(
        pageSchema,
        await api.list(requestOf(params), options),
      ) as Page<Row>,
    urlOf: (params) => api.listUrl(requestOf(params)),
  };
}
