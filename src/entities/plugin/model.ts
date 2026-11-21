import { type ZodType, z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';

// What the repository screens read of any plugin's repository, and nothing
// else. A field this schema does not name is kept as it came, so a later
// server version or a plugin's own fields cannot break a page; a plugin's
// model extends this schema with the fields only it has. The address and the
// name are required: an answer without them is not a repository. Every
// address the answer carries is a same-origin path (pulpHrefSchema), because
// it later decides where a request goes.
//
// The generated response schemas of the sdk are used for types only.
const repositorySchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  prn: z.string().nullish(),
  latest_version_href: pulpHrefSchema.nullish(),
  versions_href: pulpHrefSchema.nullish(),
  remote: pulpHrefSchema.nullish(),
  description: z.string().nullish(),
  retain_repo_versions: z.number().nullish(),
  pulp_labels: z.record(z.string(), z.string().nullable()).nullish(),
  pulp_created: z.string().nullish(),
});

// What the remote screens read of any plugin's remote, and nothing else; the
// same rules as the repository schema hold (unnamed fields are kept, the
// address and name are required, addresses are same-origin paths). The URL a
// remote syncs from and its policy are what every plugin's remote has; the
// credentials are never part of an answer.
const remoteSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  prn: z.string().nullish(),
  url: z.string().nullish(),
  policy: z.string().nullish(),
  proxy_url: z.string().nullish(),
  tls_validation: z.boolean().nullish(),
  client_cert: z.string().nullish(),
  ca_cert: z.string().nullish(),
  download_concurrency: z.number().nullish(),
  rate_limit: z.number().nullish(),
  // The secret fields of a remote (passwords, keys, tokens) are never part of
  // an answer; the server lists their names here and whether a value is set.
  hidden_fields: z
    .array(z.looseObject({ name: z.string(), is_set: z.boolean() }))
    .nullish(),
  pulp_labels: z.record(z.string(), z.string().nullable()).nullish(),
  pulp_created: z.string().nullish(),
  pulp_last_updated: z.string().nullish(),
});

// One version of a repository. The number identifies it inside its
// repository; the summary counts the content added, removed and present, per
// content type.
const contentCountSchema = z.looseObject({
  count: z.number().nullish(),
  href: z.string().nullish(),
});

const versionSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  number: z.number(),
  repository: pulpHrefSchema.nullish(),
  base_version: pulpHrefSchema.nullish(),
  pulp_created: z.string().nullish(),
  content_summary: z
    .looseObject({
      added: z.record(z.string(), contentCountSchema).nullish(),
      removed: z.record(z.string(), contentCountSchema).nullish(),
      present: z.record(z.string(), contentCountSchema).nullish(),
    })
    .nullish(),
});

// What a request that starts a task answers with: the address of the task.
const taskResponseSchema = z.looseObject({ task: pulpHrefSchema });

// What setting or unsetting a label answers with.
const labelResponseSchema = z.looseObject({
  key: z.string(),
  value: z.string().nullish(),
});

// A page of a list: the schema of one row, wrapped the way every Pulp list
// answers.
function pageSchemaOf<Row extends ZodType>(row: Row) {
  return z.looseObject({
    count: z.number(),
    next: z.string().nullish(),
    previous: z.string().nullish(),
    results: z.array(row),
  });
}

const versionPageSchema = pageSchemaOf(versionSchema);

type RepositoryBase = z.infer<typeof repositorySchema>;
type RemoteBase = z.infer<typeof remoteSchema>;
type RepositoryVersion = z.infer<typeof versionSchema>;
type RepositoryVersionPage = z.infer<typeof versionPageSchema>;

// One page of a list of rows, as parsed.
interface Page<Row> {
  count: number;
  next?: string | null;
  previous?: string | null;
  results: Row[];
}

// What a list of repositories is asked for, in the terms of a screen: the
// page and its size, the column to sort by (a leading minus sorts down) and
// the filters every plugin has. A filter that is not set is not sent.
// `name__in` and `pulp_href__in` take several values; for a request that
// would carry many of them, split the values with chunkByUrl.
interface EntityListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  name?: string;
  name__contains?: string;
  name__icontains?: string;
  name__in?: string[];
  pulp_href__in?: string[];
  pulp_label_select?: string;
  // a list of the fields the answer is cut to
  fields?: string[];
}

// What a repository list adds to the common filters.
interface RepositoryListParams extends EntityListParams {
  // the address of a remote: only the repositories that use it
  remote?: string;
}

// What the versions of a repository are asked for.
interface VersionListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  number?: number;
}

// Pages of fifty rows are what a list shows unless it is told otherwise.
const DEFAULT_PAGE_SIZE = 50;

export {
  DEFAULT_PAGE_SIZE,
  labelResponseSchema,
  pageSchemaOf,
  remoteSchema,
  repositorySchema,
  taskResponseSchema,
  versionPageSchema,
  versionSchema,
};
export type {
  EntityListParams,
  Page,
  RemoteBase,
  RepositoryBase,
  RepositoryListParams,
  RepositoryVersion,
  RepositoryVersionPage,
  VersionListParams,
};
