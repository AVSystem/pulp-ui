import { z } from 'zod';

// The fields the status screen reads, and nothing else. The server answers in
// three tiers (health only for a visitor, plus the versions for a signed-in
// account, everything for an administrator), so every key is optional and a key
// the answer leaves out stays out of the result: the screen decides which cards
// to show by the keys that are present. A field this schema does not name is
// kept as it came, because the screen shows the raw answer to a signed-in
// account, and a later server version must not break the page.
//
// The generated response schema of the sdk requires every key and would reject
// the two reduced answers, so it is used for types only, never for validation.

// A worker or an application process. An address, where one appears, is a
// plain string: it may be relative or absolute, and it is only displayed.
const processSchema = z.looseObject({
  pulp_href: z.string().optional(),
  name: z.string().nullish(),
  last_heartbeat: z.string().nullish(),
  pulp_created: z.string().nullish(),
  pulp_last_updated: z.string().nullish(),
  current_task: z.unknown().optional(),
});

const connectionSchema = z.looseObject({ connected: z.boolean() });

// Total, used and free space are measured only when artifacts live on a
// filesystem; every other backend reports them as null, and the whole entry is
// null when the lookup failed.
const measure = z.number().nullish();

const storageSchema = z.looseObject({
  total: measure,
  used: measure,
  free: measure,
});

const statusSchema = z.looseObject({
  versions: z
    .array(z.looseObject({ component: z.string(), version: z.string() }))
    .optional(),
  online_workers: z.array(processSchema).optional(),
  online_api_apps: z.array(processSchema).optional(),
  online_content_apps: z.array(processSchema).optional(),
  database_connection: connectionSchema.optional(),
  redis_connection: connectionSchema.optional(),
  storage: storageSchema.nullish(),
  content_settings: z
    .looseObject({
      content_origin: z.string().nullish(),
      content_path_prefix: z.string().optional(),
    })
    .optional(),
  domain_enabled: z.boolean().optional(),
});

type Status = z.infer<typeof statusSchema>;

export { statusSchema };
export type { Status };
