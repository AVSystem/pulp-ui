import { t } from '@lingui/core/macro';
import { useMemo } from 'react';
import { useAppContext } from 'src/app-context';
import { guardKindOf } from 'src/entities/core/content-guard/client';
import { useContentGuardNames } from 'src/entities/core/content-guard/queries';
import {
  type DistributionPlugin,
  type ListedDistribution,
  PUBLICATION_ENTITIES,
  type PublicationPlugin,
  servesFromPublication,
} from 'src/entities/core/distribution/page';
import { useDistributionFacts } from 'src/entities/core/distribution/queries';
import { usePublicationsByHref } from 'src/entities/core/publication/queries';
import { useRepositoriesByHref } from 'src/entities/core/repository/queries';
import { versionNumberOf } from 'src/entities/href';
import {
  type PublicationIndexRead,
  repositoryOfPublication,
  usePublicationIndex,
} from 'src/entities/plugin/publication';
import { requestErrorDescription } from 'src/utilities/request-error';
import type { ColumnState } from '../list/derived-columns';
import type { ColumnFailure } from '../list/list-frame';
import { PLUGIN_MANIFESTS } from '../manifest';
import { type ServedState, servedState } from '../serving/served-state';

// What the derived columns of the distribution list say about each row, from
// reads that are shared by the rows of a page: what the plugins say of the rows,
// the repositories and publications they point at, the content guards, and the
// publications of each plugin that serves from them. Each cell carries the
// state of the reads it depends on, so a column that is still loading, failed
// or cannot be told says so in every row instead of reading as "nothing".

// What a row serves.
export type Serves =
  // a repository, with its name when the user may read it
  | { kind: 'repository'; name: string | null }
  // one publication, with the number of its repository version when it is
  // known
  | { kind: 'publication'; version: number | null }
  // one repository version, pinned
  | { kind: 'version'; number: number | null }
  | { kind: 'nothing' };

export interface DistributionCells {
  // where a client of the row's plugin reaches it
  url: { state: ColumnState; value: string | null };
  serves: { state: ColumnState; value: Serves | null };
  guard: {
    pending: boolean;
    // the address of the guard, null when the row has none
    href: string | null;
    // the name, when the user may read the guard
    name: string | null;
    kind: string | null;
  };
  // the distribution has no content guard, so anyone may download from it
  isPublic: boolean;
  // null for a row no plugin owns, and while the state is not known
  served: { state: ColumnState; value: ServedState | null };
}

export interface DistributionColumns {
  // Whether every read the derived columns wait for has answered, one way or
  // the other.
  settled: boolean;
  failures: ColumnFailure[];
  cellsOf: (row: ListedDistribution) => DistributionCells;
}

type ReadStatus = 'pending' | 'error' | 'success' | 'idle';

// The state of a cell that depends on these reads.
function stateOf(...reads: ReadStatus[]): ColumnState {
  if (reads.includes('error')) {
    return 'error';
  }
  return reads.includes('pending') ? 'loading' : 'ready';
}

const unique = (values: readonly string[]) => Array.from(new Set(values));

const NO_READS: string[] = [];

// The permission that lets a user read a plugin's publications, or undefined
// for a plugin that has none to read.
function publicationView(plugin: DistributionPlugin): string | undefined {
  return PLUGIN_MANIFESTS.find((manifest) => manifest.plugin === plugin)
    ?.permissions.publication?.view;
}

const indexStatus = (read: PublicationIndexRead): ReadStatus =>
  read.status === 'ready'
    ? 'success'
    : read.status === 'error'
      ? 'error'
      : read.status;

// The derived columns of a page of the distribution list. The reads are one
// group of requests for each kind of thing the rows point at, as many groups as
// the URL budget makes of the page and never one request for a row; the
// publications of a plugin are read only when a row needs them and the user may
// read them.
export function useDistributionColumns(
  rows: readonly ListedDistribution[],
): DistributionColumns {
  const { hasPermission, permissionsReady } = useAppContext();
  const facts = useDistributionFacts(rows);

  // The plugins whose publications the user may read, as one value that only
  // changes when the answer does.
  const readableKey = (Object.keys(PUBLICATION_ENTITIES) as PublicationPlugin[])
    .filter((plugin) => {
      const view = publicationView(plugin);
      return view !== undefined && hasPermission(view);
    })
    .join(',');
  const readable = useMemo(
    () => new Set(readableKey === '' ? [] : readableKey.split(',')),
    [readableKey],
  );
  const mayReadPublications = (plugin: DistributionPlugin | null) =>
    plugin !== null && readable.has(plugin);

  // The repositories the rows are bound to. A publication-bound row names its
  // repository only through the publication, which is read once the plugins
  // have said which publications the rows are bound to.
  const repositoryHrefs = useMemo(
    () =>
      unique(
        rows.flatMap(({ repository }) => (repository ? [repository] : [])),
      ),
    [rows],
  );
  const repositories = useRepositoriesByHref(repositoryHrefs);

  const publicationHrefs = useMemo(
    () =>
      facts.facts && permissionsReady
        ? unique(
            rows.flatMap((row) => {
              const publication = facts.facts?.get(row.pulp_href)?.publication;
              return publication && mayReadPublications(row.plugin)
                ? [publication]
                : [];
            }),
          )
        : NO_READS,
    [facts.facts, rows, permissionsReady, readable],
  );
  const publications = usePublicationsByHref(publicationHrefs);

  const publicationRepositoryHrefs = useMemo(
    () =>
      publications.publications
        ? unique(
            Array.from(publications.publications.values()).flatMap((row) => {
              const repository = repositoryOfPublication(row);
              return repository !== null &&
                !repositoryHrefs.includes(repository)
                ? [repository]
                : [];
            }),
          )
        : NO_READS,
    [publications.publications, repositoryHrefs],
  );
  const publicationRepositories = useRepositoriesByHref(
    publicationRepositoryHrefs,
  );

  // The publication index of each plugin that serves from publications: read
  // when the user may read its publications and a row bound to a repository or
  // to one version of it needs to know which versions are published.
  const needsIndex = (plugin: PublicationPlugin) =>
    permissionsReady &&
    mayReadPublications(plugin) &&
    rows.some(
      (row) =>
        row.plugin === plugin && (row.repository || row.repository_version),
    );
  const indexes: Record<PublicationPlugin, PublicationIndexRead> = {
    file: usePublicationIndex(PUBLICATION_ENTITIES.file, {
      enabled: needsIndex('file'),
    }),
    deb: usePublicationIndex(PUBLICATION_ENTITIES.deb, {
      enabled: needsIndex('deb'),
    }),
    rpm: usePublicationIndex(PUBLICATION_ENTITIES.rpm, {
      enabled: needsIndex('rpm'),
    }),
  };

  const guardHrefs = useMemo(
    () =>
      unique(
        rows.flatMap(({ content_guard }) =>
          content_guard ? [content_guard] : [],
        ),
      ),
    [rows],
  );
  const guards = useContentGuardNames(guardHrefs);

  const { facts: factsByHref } = facts;
  const { repositories: pageRepositories } = repositories;
  const { repositories: otherRepositories } = publicationRepositories;
  const { publications: publicationsByHref } = publications;
  const { names } = guards;
  const { file: fileIndex, deb: debIndex, rpm: rpmIndex } = indexes;

  const cellsByHref = useMemo(() => {
    const cells = new Map<string, DistributionCells>();
    const indexOf: Record<PublicationPlugin, PublicationIndexRead> = {
      file: fileIndex,
      deb: debIndex,
      rpm: rpmIndex,
    };
    const latestVersionHref = (repository: string | null) =>
      repository === null
        ? null
        : (
            pageRepositories?.get(repository) ??
            otherRepositories?.get(repository)
          )?.latest_version_href;

    for (const row of rows) {
      const plugin = row.plugin;
      const own = factsByHref?.get(row.pulp_href);
      const publication = own?.publication ?? null;
      const mayRead = permissionsReady && mayReadPublications(plugin);
      const publicationRow = publication
        ? publicationsByHref?.get(publication)
        : undefined;
      const publicationRepository = publicationRow
        ? repositoryOfPublication(publicationRow)
        : null;
      const boundToRepositoryOrVersion = !!(
        row.repository || row.repository_version
      );
      const index =
        plugin !== null && servesFromPublication(plugin)
          ? indexOf[plugin]
          : null;
      const needsIndexRead =
        index !== null && mayRead && !publication && boundToRepositoryOrVersion;

      // what a row serves
      const servesState = row.repository
        ? stateOf(repositories.status)
        : row.repository_version
          ? 'ready'
          : stateOf(
              facts.status,
              publication && mayRead ? publications.status : 'success',
            );
      let serves: Serves | null = null;
      if (servesState === 'ready') {
        if (row.repository) {
          serves = {
            kind: 'repository',
            name: pageRepositories?.get(row.repository)?.name ?? null,
          };
        } else if (row.repository_version) {
          serves = {
            kind: 'version',
            number: versionNumberOf(row.repository_version),
          };
        } else if (publication) {
          serves = {
            kind: 'publication',
            version: publicationRow
              ? versionNumberOf(publicationRow.repository_version)
              : null,
          };
        } else {
          serves = { kind: 'nothing' };
        }
      }

      // whether it works
      let served: ServedState | null = null;
      const servedReads: ReadStatus[] = [
        permissionsReady ? 'success' : 'pending',
        facts.status,
      ];
      if (row.repository && index !== null && mayRead) {
        servedReads.push(repositories.status);
      }
      if (needsIndexRead) {
        servedReads.push(indexStatus(index));
      }
      if (publication && mayRead) {
        servedReads.push(publications.status, publicationRepositories.status);
      }
      const servedReadState =
        plugin === null ? 'ready' : stateOf(...servedReads);
      if (plugin !== null && servedReadState === 'ready') {
        const readIndex = index && needsIndexRead ? index.index : undefined;
        const boundVersion = versionNumberOf(row.repository_version);
        const published = (): number[] => {
          if (!readIndex) {
            return [];
          }
          if (row.repository_version) {
            return boundVersion !== null &&
              readIndex.versionHasPublication(row.repository_version)
              ? [boundVersion]
              : [];
          }
          const newest = row.repository
            ? readIndex.newestPublishedVersion(row.repository)
            : null;
          return newest === null ? [] : [newest];
        };
        served = servedState({
          servesFromPublication: servesFromPublication(plugin),
          checkpoint: own?.checkpoint === true,
          canReadPublications: mayRead,
          indexOverBound: readIndex?.overBound ?? false,
          binding: {
            repository: row.repository,
            publication,
            repository_version: row.repository_version,
          },
          latestVersion: versionNumberOf(
            latestVersionHref(row.repository ?? publicationRepository),
          ),
          publishedVersions: published(),
          boundVersion,
          publicationVersion: publicationRow
            ? versionNumberOf(publicationRow.repository_version)
            : undefined,
        });
      }

      const guardHref = row.content_guard ?? null;
      cells.set(row.pulp_href, {
        url: {
          state: plugin === null ? 'ready' : stateOf(facts.status),
          value: own?.url ?? null,
        },
        serves: { state: servesState, value: serves },
        guard: {
          pending: guardHref !== null && guards.pending,
          href: guardHref,
          name: guardHref ? (names.get(guardHref) ?? null) : null,
          kind: guardKindOf(guardHref),
        },
        isPublic: guardHref === null,
        served: { state: servedReadState, value: served },
      });
    }

    return cells;
  }, [
    readable,
    rows,
    factsByHref,
    facts.status,
    repositories.status,
    pageRepositories,
    otherRepositories,
    publicationRepositories.status,
    publicationsByHref,
    publications.status,
    fileIndex,
    debIndex,
    rpmIndex,
    names,
    guards.pending,
    permissionsReady,
  ]);

  const cellsOf = (row: ListedDistribution) =>
    cellsByHref.get(row.pulp_href) as DistributionCells;

  const indexReads = Object.values(indexes);
  const settled =
    permissionsReady &&
    facts.status !== 'pending' &&
    repositories.status !== 'pending' &&
    publications.status !== 'pending' &&
    publicationRepositories.status !== 'pending' &&
    !guards.pending &&
    indexReads.every(({ status }) => status !== 'pending');

  const failures: ColumnFailure[] = [];
  if (facts.status === 'error') {
    failures.push({
      id: 'facts',
      title: t`Distribution details could not be read.`,
      retry: facts.retry,
      description: requestErrorDescription(facts.error),
    });
  }
  const repositoryFailure = [repositories, publicationRepositories].find(
    ({ status }) => status === 'error',
  );
  if (repositoryFailure) {
    failures.push({
      id: 'repositories',
      title: t`Repositories could not be read.`,
      retry: () => {
        repositories.retry();
        publicationRepositories.retry();
      },
      description: requestErrorDescription(repositoryFailure.error),
    });
  }
  const publicationFailure =
    publications.status === 'error'
      ? publications
      : indexReads.find(({ status }) => status === 'error');
  if (publicationFailure) {
    failures.push({
      id: 'publications',
      title: t`Publications could not be read.`,
      retry: () => {
        publications.retry();
        for (const read of indexReads) {
          if (read.status === 'error') {
            read.retry();
          }
        }
      },
      description: requestErrorDescription(publicationFailure.error),
    });
  }

  return { settled, failures, cellsOf };
}
