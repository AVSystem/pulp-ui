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

type FileRepository = z.infer<typeof fileRepositorySchema>;
type FileRemote = z.infer<typeof fileRemoteSchema>;

export { fileRemoteSchema, fileRepositorySchema };
export type { FileRemote, FileRepository };
