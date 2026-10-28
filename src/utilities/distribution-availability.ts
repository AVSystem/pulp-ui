import { GenericDistributionAPI } from '../api/generic-pulp';
import { basePathAncestors, isUnderBasePath } from './base-path-rules';

export interface DistributionRef {
  name: string;
  base_path: string;
}

export interface DistributionConflicts {
  // a distribution of any plugin that already has this name
  name: DistributionRef | null;
  // a distribution whose base path is equal to, an ancestor of, or nested
  // below the requested one
  basePath: DistributionRef | null;
}

const FIELDS = 'name,base_path,pulp_href';

// Mirrors the server's check so a conflict is refused before anything is
// created: names and base paths are unique across every plugin, and a base
// path may not equal, contain or sit under another one. The server stays
// authoritative; this only avoids leaving a repository behind without its
// distribution. The nested-below query matches anywhere in the path and is
// filtered here to real descendants, so a path that merely contains the text
// elsewhere is not reported. Errors propagate: a check that could not run is
// not a check that passed.
export async function distributionConflicts(
  name: string,
  basePath: string,
): Promise<DistributionConflicts> {
  const [sameName, sameOrAncestor, nested] = await Promise.all([
    GenericDistributionAPI.list({ name, fields: FIELDS, page_size: 1 }),
    GenericDistributionAPI.list({
      base_path__in: basePathAncestors(basePath).join(','),
      fields: FIELDS,
      page_size: 10,
    }),
    GenericDistributionAPI.list({
      base_path__contains: `${basePath}/`,
      fields: FIELDS,
      page_size: 100,
    }),
  ]);

  const pick = ({ name, base_path }): DistributionRef => ({ name, base_path });

  const byName = sameName.data.results[0];
  const byPath =
    sameOrAncestor.data.results[0] ||
    nested.data.results.find((result) =>
      isUnderBasePath(result.base_path, basePath),
    );

  return {
    name: byName ? pick(byName) : null,
    basePath: byPath ? pick(byPath) : null,
  };
}
