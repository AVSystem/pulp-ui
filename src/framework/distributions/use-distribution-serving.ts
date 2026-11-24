import { useCallback, useMemo } from 'react';
import { useAppContext } from 'src/app-context';
import { usePublicationsByHref } from 'src/entities/core/publication/queries';
import { useRepositoriesByHref } from 'src/entities/core/repository/queries';
import { repositoryOfVersion, versionNumberOf } from 'src/entities/href';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import {
  publicationKeys,
  repositoryOfPublication,
} from 'src/entities/plugin/publication';
import { useSessionQuery } from 'src/query/use-session-query';
import type { PluginDescriptor } from '../descriptor';
import type { ColumnState } from '../list/derived-columns';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';
import { type ServedState, servedState } from '../serving/served-state';
import type { Serves } from './use-distribution-columns';

// What one distribution serves and whether that works, from single reads: the
// repository it is bound to (or that its publication was made from) and the
// publications of that one repository. The plugin-wide indexes the lists use
// are never read here, so opening one distribution costs a handful of small
// requests however many distributions and publications the server holds.

export interface DistributionServing {
  serves: { state: ColumnState; value: Serves | null };
  served: { state: ColumnState; value: ServedState | null };
  // The repository the distribution serves from, or the one its publication was
  // made from; null while it is not known or when nothing is bound.
  repository: string | null;
  // The reason of the first read that failed, when one did.
  error: unknown;
  // Reads again what failed.
  retry: () => void;
}

type ReadStatus = 'pending' | 'error' | 'success';

// The state of a cell that depends on these reads.
function stateOf(...reads: ReadStatus[]): ColumnState {
  if (reads.includes('error')) {
    return 'error';
  }
  return reads.includes('pending') ? 'loading' : 'ready';
}

const NO_READS: string[] = [];

// How long the publications of the repository are taken as current: the same
// as the other screens that read them, so the read is shared.
const PUBLICATIONS_STALE_MS = 30_000;

// What a distribution serves and its state, decided by the rules every screen
// shares (`servedState`). A user who may not read the plugin's publications is
// told "cannot be checked" there, and no read of publications is made for them.
export function useDistributionServing({
  plugin,
  descriptor,
  distribution,
}: {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  distribution: DistributionBase;
}): DistributionServing {
  const { hasPermission, permissionsReady } = useAppContext();
  const { repository, publication, repository_version } = distribution;

  const viewPermission = PLUGIN_MANIFESTS.find(
    (manifest) => manifest.plugin === plugin,
  )?.permissions.publication?.view;
  const mayRead =
    permissionsReady &&
    viewPermission !== undefined &&
    hasPermission(viewPermission);
  const publicationKind = descriptor.publication;
  const servesFromPublication = publicationKind?.servesFromPublication ?? false;

  // The publication a publication-bound distribution serves.
  const publicationHrefs = useMemo(
    () => (publication && mayRead ? [publication] : NO_READS),
    [publication, mayRead],
  );
  const publications = usePublicationsByHref(publicationHrefs);
  const publicationRow = publication
    ? publications.publications?.get(publication)
    : undefined;
  const publicationRepository = publicationRow
    ? repositoryOfPublication(publicationRow)
    : null;

  // The repository whose name and latest version are needed: the one the
  // distribution is bound to, or the one its publication was made from.
  const repositoryHref = repository ?? publicationRepository;
  const repositoryHrefs = useMemo(
    () => (repositoryHref ? [repositoryHref] : NO_READS),
    [repositoryHref],
  );
  const repositories = useRepositoriesByHref(repositoryHrefs);

  // The publications of the one repository a repository-bound or
  // version-bound distribution serves from.
  const publishedOf =
    servesFromPublication &&
    mayRead &&
    !publication &&
    distribution.checkpoint !== true
      ? (repository ?? repositoryOfVersion(repository_version))
      : null;
  const entity = publicationKind?.entity;
  const published = useSessionQuery({
    queryKey: publicationKeys(
      entity ?? { app: plugin, object: 'publication' },
    ).ofRepository(publishedOf ?? ''),
    queryFn: ({ signal }) =>
      (entity as NonNullable<typeof entity>).ofRepository(
        publishedOf as string,
        { signal },
      ),
    staleTime: PUBLICATIONS_STALE_MS,
    enabled: publishedOf !== null && entity !== undefined,
  });
  const publishedStatus: ReadStatus =
    publishedOf === null ? 'success' : published.status;

  const serving = useMemo<DistributionServing['serves']>(() => {
    const state = repository
      ? stateOf(repositories.status)
      : repository_version
        ? 'ready'
        : stateOf(publication && mayRead ? publications.status : 'success');
    if (state !== 'ready') {
      return { state, value: null };
    }
    if (repository) {
      return {
        state,
        value: {
          kind: 'repository',
          name: repositories.repositories?.get(repository)?.name ?? null,
        },
      };
    }
    if (repository_version) {
      return {
        state,
        value: { kind: 'version', number: versionNumberOf(repository_version) },
      };
    }
    if (publication) {
      return {
        state,
        value: {
          kind: 'publication',
          version: publicationRow
            ? versionNumberOf(publicationRow.repository_version)
            : null,
        },
      };
    }
    return { state, value: { kind: 'nothing' } };
  }, [
    repository,
    repository_version,
    publication,
    mayRead,
    publications.status,
    repositories.status,
    repositories.repositories,
    publicationRow,
  ]);

  const publishedRows = published.data;
  const served = useMemo<DistributionServing['served']>(() => {
    const reads: ReadStatus[] = [
      permissionsReady ? 'success' : 'pending',
      publishedStatus,
    ];
    if (servesFromPublication && mayRead && repositoryHref) {
      reads.push(repositories.status);
    }
    if (publication && mayRead) {
      reads.push(publications.status);
    }
    const state = stateOf(...reads);
    if (state !== 'ready') {
      return { state, value: null };
    }
    const latestVersionHref = repositoryHref
      ? repositories.repositories?.get(repositoryHref)?.latest_version_href
      : null;

    return {
      state,
      value: servedState({
        servesFromPublication,
        checkpoint: distribution.checkpoint === true,
        canReadPublications: mayRead,
        binding: { repository, publication, repository_version },
        latestVersion: versionNumberOf(latestVersionHref),
        publishedVersions: (publishedRows ?? []).flatMap((row) => {
          const version = versionNumberOf(row.repository_version);
          return version === null ? [] : [version];
        }),
        boundVersion: versionNumberOf(repository_version),
        publicationVersion: publicationRow
          ? versionNumberOf(publicationRow.repository_version)
          : undefined,
      }),
    };
  }, [
    permissionsReady,
    publishedStatus,
    servesFromPublication,
    mayRead,
    repositoryHref,
    repositories.status,
    repositories.repositories,
    publication,
    publications.status,
    distribution.checkpoint,
    repository,
    repository_version,
    publishedRows,
    publicationRow,
  ]);

  const { retry: retryRepositories } = repositories;
  const { retry: retryPublications } = publications;
  const { refetch: refetchPublished } = published;
  const failedRepositories = repositories.status === 'error';
  const failedPublications = publications.status === 'error';
  const failedPublished = publishedOf !== null && published.status === 'error';
  const retry = useCallback(() => {
    if (failedRepositories) {
      retryRepositories();
    }
    if (failedPublications) {
      retryPublications();
    }
    if (failedPublished) {
      void refetchPublished();
    }
  }, [
    failedRepositories,
    failedPublications,
    failedPublished,
    retryRepositories,
    retryPublications,
    refetchPublished,
  ]);

  return {
    serves: serving,
    served,
    repository: repositoryHref ?? null,
    error: repositories.error ?? publications.error ?? published.error,
    retry,
  };
}
