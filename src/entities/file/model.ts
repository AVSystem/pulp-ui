import { z } from 'zod';
import { remoteSchema, repositorySchema } from 'src/entities/plugin/model';

// A file repository: the fields every repository has and the ones only this
// plugin adds. As in every model, a field not named here is kept as it came.
const fileRepositorySchema = repositorySchema.extend({
  autopublish: z.boolean().nullish(),
  manifest: z.string().nullish(),
  retain_checkpoints: z.number().nullish(),
  sha256sums: z.string().nullish(),
});

// A file remote has no field beyond the ones every remote has that a screen
// reads; its own settings (concurrency, timeouts, headers, the secret fields
// listed as hidden) pass through unchanged.
const fileRemoteSchema = remoteSchema.extend({});

// One file of a repository version, as far as the version page reads it: its
// path in the repository and when the server first saw it.
const fileContentSchema = z.looseObject({
  pulp_href: z.string(),
  relative_path: z.string(),
  pulp_created: z.string().nullish(),
});

type FileRepository = z.infer<typeof fileRepositorySchema>;
type FileRemote = z.infer<typeof fileRemoteSchema>;
type FileContent = z.infer<typeof fileContentSchema>;

export { fileContentSchema, fileRemoteSchema, fileRepositorySchema };
export type { FileContent, FileRemote, FileRepository };
