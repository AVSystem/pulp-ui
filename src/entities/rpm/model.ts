import { z } from 'zod';
import { remoteSchema, repositorySchema } from 'src/entities/plugin/model';

// An rpm repository: the fields every repository has and the ones only this
// plugin adds. As in every model, a field not named here is kept as it came.
// The number of versions kept per package is never null on the server: 0 keeps
// every version.
const rpmRepositorySchema = repositorySchema.extend({
  autopublish: z.boolean().nullish(),
  checksum_type: z.string().nullish(),
  compression_type: z.string().nullish(),
  retain_package_versions: z.number().nullish(),
});

// An rpm remote has no field the generic remote lacks.
const rpmRemoteSchema = remoteSchema;

// One package of a repository version, as far as the Packages tab reads it.
// The epoch is a number on the server and a text in older answers, so both are
// taken.
const rpmPackageSchema = z.looseObject({
  pulp_href: z.string(),
  name: z.string(),
  epoch: z.union([z.string(), z.number()]).nullish(),
  version: z.string(),
  release: z.string().nullish(),
  arch: z.string().nullish(),
  summary: z.string().nullish(),
});

type RpmRepository = z.infer<typeof rpmRepositorySchema>;
type RpmRemote = z.infer<typeof rpmRemoteSchema>;
type RpmPackage = z.infer<typeof rpmPackageSchema>;

export { rpmPackageSchema, rpmRemoteSchema, rpmRepositorySchema };
export type { RpmPackage, RpmRemote, RpmRepository };
