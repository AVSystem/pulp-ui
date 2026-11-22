import { useMemo } from 'react';
import { useAppContext } from 'src/app-context';
import { versionNumberOf } from 'src/entities/href';
import {
  type DistributionBase,
  type RepositoryDistributions,
  useRepositoryDistributions,
} from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PluginDescriptor } from '../descriptor';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { type ServedState, servedState } from './served-state';

// A distribution that serves a repository, with what it serves.
export interface ServedDistribution {
  row: DistributionBase;
  served: ServedState;
}

export interface ServedDistributions {
  status: RepositoryDistributions<DistributionBase>['status'];
  error: unknown;
  // The distributions that serve the repository, in the order of the index,
  // each with its state; undefined until they are all known.
  distributions: ServedDistribution[] | undefined;
  // Reads again what failed.
  retry: () => void;
}

// The distributions that serve one repository, each with what it serves. This
// is the one place a screen gets the state of a distribution from: the entity
// reads the facts, the rules of `servedState` decide, and the user's right to
// read the plugin's publications is applied here, so a user who may not read
// them is told "cannot be checked" and never "serves nothing".
export function useServedDistributions({
  plugin,
  distribution,
  publication,
  repository,
}: {
  plugin: FrameworkPlugin;
  distribution: NonNullable<PluginDescriptor['distribution']>['entity'];
  publication: PluginDescriptor['publication'];
  repository: Pick<RepositoryBase, 'pulp_href' | 'latest_version_href'>;
}): ServedDistributions {
  const { hasPermission } = useAppContext();
  const serving = useRepositoryDistributions(
    distribution,
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
  const { facts } = serving;

  const distributions = useMemo(() => {
    if (!serving.distributions || !facts) {
      return undefined;
    }
    return serving.distributions.map(({ row }) => ({
      row,
      served: servedState({
        servesFromPublication,
        checkpoint: row.checkpoint === true,
        canReadPublications,
        binding: row,
        latestVersion: facts.latestVersion,
        publishedVersions: facts.publishedVersions,
        boundVersion: versionNumberOf(row.repository_version),
        publicationVersion: row.publication
          ? facts.publicationVersions.get(row.publication)
          : undefined,
      }),
    }));
  }, [
    serving.distributions,
    facts,
    servesFromPublication,
    canReadPublications,
  ]);

  return {
    status: serving.status,
    error: serving.error,
    distributions,
    retry: serving.retry,
  };
}
