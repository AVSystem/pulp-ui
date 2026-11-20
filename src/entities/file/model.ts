import { z } from 'zod';
import { repositorySchema } from 'src/entities/plugin/model';

// A file repository: the fields every repository has and the ones only this
// plugin adds. As in every model, a field not named here is kept as it came.
const fileRepositorySchema = repositorySchema.extend({
  autopublish: z.boolean().nullish(),
  manifest: z.string().nullish(),
  retain_checkpoints: z.number().nullish(),
  sha256sums: z.string().nullish(),
});

type FileRepository = z.infer<typeof fileRepositorySchema>;

export { fileRepositorySchema };
export type { FileRepository };
