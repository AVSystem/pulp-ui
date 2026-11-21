import { z } from 'zod';
import { pulpHrefSchema } from 'src/entities/href';
import { distributionSchema } from 'src/entities/plugin/distribution';
import { remoteSchema, repositorySchema } from 'src/entities/plugin/model';

// A python repository: the fields every repository has and the ones only this
// plugin adds. As in every model, a field not named here is kept as it came.
// The two package rules are never null on the server: both default to on.
const pythonRepositorySchema = repositorySchema.extend({
  allow_package_substitution: z.boolean().nullish(),
  error_on_reject: z.boolean().nullish(),
});

// A python remote: which projects and package types it syncs and what else it
// takes. The lists are never null on the server; an empty one means no limit.
const pythonRemoteSchema = remoteSchema.extend({
  includes: z.array(z.string()).nullish(),
  excludes: z.array(z.string()).nullish(),
  prereleases: z.boolean().nullish(),
  package_types: z.array(z.string()).nullish(),
  keep_latest_packages: z.number().nullish(),
  exclude_platforms: z.array(z.string()).nullish(),
  provenance: z.boolean().nullish(),
  vulnerabilities: z.boolean().nullish(),
});

// One package of a repository version, as far as the Packages tab reads it. A
// package that states no Python requirement has none, which is not an error.
const pythonPackageSchema = z.looseObject({
  pulp_href: z.string(),
  name: z.string(),
  version: z.string(),
  packagetype: z.string().nullish(),
  filename: z.string().nullish(),
  requires_python: z.string().nullish(),
});

// A python distribution: the pull-through remote that fetches what the index
// lacks, and whether packages may be uploaded to it. Uploads are on unless the
// server says otherwise.
const pythonDistributionSchema = distributionSchema.extend({
  remote: pulpHrefSchema.nullish(),
  allow_uploads: z.boolean().nullish(),
});

// What a change of a python distribution may carry: the two fields the screens
// edit and no other, so a name, a base path, a repository or a content guard is
// never sent by accident.
interface PythonDistributionChanges {
  remote?: string | null;
  allow_uploads?: boolean;
}

type PythonRepository = z.infer<typeof pythonRepositorySchema>;
type PythonRemote = z.infer<typeof pythonRemoteSchema>;
type PythonDistribution = z.infer<typeof pythonDistributionSchema>;
type PythonPackage = z.infer<typeof pythonPackageSchema>;

export {
  pythonDistributionSchema,
  pythonPackageSchema,
  pythonRemoteSchema,
  pythonRepositorySchema,
};
export type {
  PythonDistribution,
  PythonDistributionChanges,
  PythonPackage,
  PythonRemote,
  PythonRepository,
};
