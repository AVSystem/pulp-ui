import type { ZodType } from 'zod';
import { parseResponse } from 'src/entities/response-shape';
import { type Page, labelResponseSchema, pageSchemaOf } from './model';
import { type Options, asParams, taskOf, toListRequest } from './request';

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
  // The label calls of the content type, for a type whose units carry labels.
  setLabel?: (
    href: string,
    body: { key: string; value: string | null },
    options?: Options,
  ) => Promise<unknown>;
  unsetLabel?: (
    href: string,
    body: { key: string },
    options?: Options,
  ) => Promise<unknown>;
}

// What a screen gives the content create of a plugin. The bytes come either as
// a file in the request or as an upload that was sent in chunks beforehand;
// `repository` is the repository the new content is added to in the same step.
export interface ContentCreateBody {
  file?: Blob;
  upload?: string;
  repository?: string;
  relative_path?: string;
}

// The fields of a content create that name the unit, apart from its bytes and
// its repository.
export interface ContentFields {
  relative_path?: string;
}

// How a plugin takes the path of a unit that is uploaded: a python package is
// always named by its file name; a file unit needs a path, which is the file
// name unless the user gave one; deb and rpm packages carry their own path and
// take one only when the user gave one.
export type RelativePathRule = 'file-name' | 'given-or-file-name' | 'given';

// The fields a create of this plugin sends for a file, from the name of the
// file and the path the user gave, if any.
export function contentFieldsOf(
  rule: RelativePathRule,
  fileName: string,
  given?: string,
): ContentFields {
  const typed = given?.trim();

  if (rule === 'file-name') {
    return { relative_path: fileName };
  }
  if (rule === 'given-or-file-name') {
    return { relative_path: typed || fileName };
  }
  return typed ? { relative_path: typed } : {};
}

// What a plugin's generated client offers for creating content, and how the
// plugin names an uploaded unit.
interface ContentUploadApi {
  create: (body: ContentCreateBody, options?: Options) => Promise<unknown>;
  relativePath: RelativePathRule;
}

export interface ContentEntity<Row> {
  readonly app: string;
  readonly object: string;
  list: (params: ContentListParams, options?: Options) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params: ContentListParams) => string;
  // Sets and removes one label of a unit of content, for the types whose units
  // carry labels the screens may change. A label belongs to the unit, so it
  // shows in every repository that holds the unit.
  setLabel?: (
    href: string,
    label: { key: string; value: string | null },
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
  unsetLabel?: (
    href: string,
    key: string,
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
}

// A content entity whose units can be created from a file: the screens that
// upload read and write through it.
export interface UploadableContent<Row> extends ContentEntity<Row> {
  // Creates content from a file or from a finished upload with one multipart
  // request and answers the address of the task that does it. With a
  // repository in the body the task also adds the content to it as a new
  // version.
  create: (body: ContentCreateBody, options?: Options) => Promise<string>;
  // The fields that name a file's unit for this plugin: its path, from the
  // file name and the path the user gave.
  fieldsOf: (fileName: string, relativePath?: string) => ContentFields;
}

interface ContentEntityOptions<Row, TListParams> {
  app: string;
  // The name of the content type in the cache: 'package'.
  object: string;
  schema: ZodType<Row>;
  // The single-value filters the content type has besides the version.
  textFilters: readonly string[];
  api: ContentApi<TListParams>;
}

// Builds the content entity of a plugin from its generated functions. The
// parameters a screen names are turned into what the server takes: an offset
// and a limit, an ordering and the text filters named here. A plugin whose
// units can be created from a file names the create too.
export function makeContentEntity<Row, TListParams>(
  options: ContentEntityOptions<Row, TListParams> & {
    upload: ContentUploadApi;
  },
): UploadableContent<Row>;
export function makeContentEntity<Row, TListParams>(
  options: ContentEntityOptions<Row, TListParams>,
): ContentEntity<Row>;
export function makeContentEntity<Row, TListParams>({
  app,
  object,
  schema,
  textFilters,
  api,
  upload,
}: ContentEntityOptions<Row, TListParams> & {
  upload?: ContentUploadApi;
}): ContentEntity<Row> | UploadableContent<Row> {
  const pageSchema = pageSchemaOf(schema);

  const requestOf = (params: ContentListParams) =>
    asParams<TListParams>({
      ...toListRequest(params, textFilters),
      ...versionFilterOf(params),
    });

  const { setLabel, unsetLabel } = api;

  const entity: ContentEntity<Row> = {
    app,
    object,
    list: async (params, options) =>
      parseResponse(
        pageSchema,
        await api.list(requestOf(params), options),
      ) as Page<Row>,
    urlOf: (params) => api.listUrl(requestOf(params)),
    ...(setLabel && unsetLabel
      ? {
          setLabel: async (href, label, options) =>
            parseResponse(
              labelResponseSchema,
              await setLabel(href, label, options),
            ),
          unsetLabel: async (href, key, options) =>
            parseResponse(
              labelResponseSchema,
              await unsetLabel(href, { key }, options),
            ),
        }
      : {}),
  };

  if (!upload) {
    return entity;
  }

  const { create, relativePath } = upload;

  return {
    ...entity,
    create: async (body, options) => taskOf(await create(body, options)),
    fieldsOf: (fileName, given) =>
      contentFieldsOf(relativePath, fileName, given),
  };
}
