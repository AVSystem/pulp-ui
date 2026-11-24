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

// One deb package of a repository version, as far as the version page reads
// it: the package name, its version and the architecture it is built for.
const debPackageSchema = z.looseObject({
  pulp_href: z.string(),
  package: z.string(),
  version: z.string(),
  architecture: z.string().nullish(),
});

type DebRepository = z.infer<typeof debRepositorySchema>;
type DebRemote = z.infer<typeof debRemoteSchema>;
type DebPackage = z.infer<typeof debPackageSchema>;

export { debPackageSchema, debRemoteSchema, debRepositorySchema };
export type { DebPackage, DebRemote, DebRepository };
