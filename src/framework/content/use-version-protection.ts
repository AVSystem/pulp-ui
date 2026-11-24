import { useMemo } from 'react';
import { useAppContext } from 'src/app-context';
import {
  type DistributionBase,
  useRepositoryDistributions,
} from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PluginDescriptor } from '../descriptor';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { type ProtectionReason, protectedVersions } from './protected-versions';

// What a plugin without distributions answers: none.
const NO_DISTRIBUTIONS = {
  app: 'none',
  object: 'distribution' as const,
  index: () => Promise.resolve([] as DistributionBase[]),
};

export interface VersionProtection {
  // The distributions that decide are still being read.
  pending: boolean;
  // Why a version cannot be deleted; empty when nothing is known to stop it.
  // When the distributions could not be read, only what the version count
  // says is known, and the server's refusal stands for the rest.
  reasonsOf: (number: number) => ProtectionReason[];
}

// The reasons the server would refuse to delete each of some versions of a
// repository, from the distributions that serve it and, where the plugin
// serves publications and the user may read them, the repository's
// publications. The reads are the ones every screen of the repository shares.
// A user who may not read the publications is told nothing that depends on
// them: the action stays available and the server's answer is shown.
export function useVersionProtection({
  plugin,
  descriptor,
  repository,
  versions,
  totalVersions,
}: {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: Pick<RepositoryBase, 'pulp_href' | 'latest_version_href'>;
  // The numbers of the versions the screen shows.
  versions: readonly number[];
  // How many versions the repository has, or undefined while that is unknown.
  totalVersions: number | undefined;
}): VersionProtection {
  const { hasPermission } = useAppContext();
  const { distribution, publication } = descriptor;
  const serving = useRepositoryDistributions(
    distribution?.entity ?? NO_DISTRIBUTIONS,
    publication,
    repository.pulp_href,
    repository.latest_version_href,
  );
  const viewPermission = PLUGIN_MANIFESTS.find(
    (manifest) => manifest.plugin === plugin,
  )?.permissions.publication?.view;
  const canReadPublications =
    viewPermission !== undefined && hasPermission(viewPermission);
  const servesFromPublication = publication?.servesFromPublication ?? false;
  const { distributions, facts } = serving;

  const key = versions.join(',');
  const reasons = useMemo(
    () =>
      protectedVersions({
        versions: key === '' ? [] : key.split(',').map(Number),
        totalVersions: totalVersions ?? 0,
        distributions:
          serving.status === 'success' ? (distributions ?? []) : [],
        publicationVersions: facts?.publicationVersions ?? new Map(),
        publishedVersions:
          servesFromPublication && !canReadPublications
            ? null
            : (facts?.publishedVersions ?? null),
        latestVersion: facts?.latestVersion ?? null,
        servesFromPublication,
      }),
    [
      key,
      totalVersions,
      serving.status,
      distributions,
      facts,
      servesFromPublication,
      canReadPublications,
    ],
  );

  return {
    pending: serving.status === 'pending' || totalVersions === undefined,
    reasonsOf: (number) => reasons.get(number) ?? [],
  };
}
