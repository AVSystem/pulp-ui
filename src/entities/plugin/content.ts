import type { ZodType } from 'zod';
import { parseResponse } from 'src/entities/response-shape';
import { type Page, pageSchemaOf } from './model';
import { type Options, asParams, toListRequest } from './request';

// The content entity of a plugin: one kind of content (files, packages) as a
// repository screen reads it. A list is cut to one repository version, to what
// a version added or to what it removed; a list with none of the three is every
// unit of the type the user may see.

// What a list of content is asked for apart from the version: the page, its
// size and order and the plugin's own text filters.
interface ContentListBase {
  page?: number;
  page_size?: number;
  sort?: string;
  // the fields the answer is cut to
  fields?: string[];
  [filter: string]: string | number | string[] | undefined;
}

// Which part of a repository the list is cut to. Exactly one of the three
// version filters, each the address of a repository version, or none. The
// three exclude each other: the server would apply all of them and answer the
// intersection, which no screen means. A list with none is not scoped to a
// repository at all: it holds all content of the type that the user may see.
type VersionScope =
  | {
      repository_version: string;
      repository_version_added?: never;
      repository_version_removed?: never;
    }
  | {
      repository_version?: never;
      repository_version_added: string;
      repository_version_removed?: never;
    }
  | {
      repository_version?: never;
      repository_version_added?: never;
      repository_version_removed: string;
    }
  | {
      repository_version?: never;
      repository_version_added?: never;
      repository_version_removed?: never;
    };

export type ContentListParams = ContentListBase & VersionScope;

const VERSION_FILTERS = [
  'repository_version',
  'repository_version_added',
  'repository_version_removed',
] as const;

// The version filter a list carries, as the one query parameter it is sent
// under. Two filters at once are refused: it is a mistake of the caller.
function versionFilterOf(params: ContentListParams): Record<string, string> {
  const given = VERSION_FILTERS.flatMap((key) => {
    const value = (params as Record<string, unknown>)[key];

    return typeof value === 'string' && value !== '' ? [[key, value]] : [];
  });
  if (given.length > 1) {
    throw new Error('A content list takes one version filter at most');
  }

  return Object.fromEntries(given);
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
      ...versionFilterOf(params),
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
