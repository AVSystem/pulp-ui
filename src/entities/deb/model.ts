import { z } from 'zod';
import { remoteSchema, repositorySchema } from 'src/entities/plugin/model';

// A deb repository: the fields every repository has and the ones only this
// plugin adds. As in every model, a field not named here is kept as it came.
const debRepositorySchema = repositorySchema.extend({
  autopublish: z.boolean().nullish(),
  publish_upstream_release_fields: z.boolean().nullish(),
});

// A deb remote: the suites, components and architectures it syncs, the
// public key that signed the upstream release and what besides binary
// packages it takes. The distributions are required of a new remote; the other
// fields of an answer pass through unchanged.
const debRemoteSchema = remoteSchema.extend({
  distributions: z.string().nullish(),
  components: z.string().nullish(),
  architectures: z.string().nullish(),
  gpgkey: z.string().nullish(),
  sync_sources: z.boolean().nullish(),
  sync_udebs: z.boolean().nullish(),
  sync_installer: z.boolean().nullish(),
});

type DebRepository = z.infer<typeof debRepositorySchema>;
type DebRemote = z.infer<typeof debRemoteSchema>;

export { debRemoteSchema, debRepositorySchema };
export type { DebRemote, DebRepository };
