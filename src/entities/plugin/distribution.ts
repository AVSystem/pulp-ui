import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { type ZodType, z } from 'zod';
import {
  pulpHrefSchema,
  repositoryOfVersion,
  versionNumberOf,
} from 'src/entities/href';
import { parseResponse } from 'src/entities/response-shape';
import { useSessionQuery } from 'src/query/use-session-query';
import { useSessionEnded } from 'src/session/session-events';
import { servedState } from 'src/utilities/distribution-serving';
import { type Page, labelResponseSchema, pageSchemaOf } from './model';
import {
  type PublicationBase,
  type PublicationEntity,
  publicationKeys,
  repositoryOfPublication,
} from './publication';
import { entityKeys } from './queries';
import {
  EMPTY_PAGE,
  type Options,
  type UpdateResult,
  asParams,
  matchesNothing,
  parseUpdate,
  taskOf,
  toListRequest,
} from './request';

// The distribution entity of every plugin, built from the plugin's own
// generated functions like the repository entity, and the index that lets a
// list of repositories show where each one is served without asking the
// server once per row.
//
// What the screens read of a distribution: where it is served from, what it
// is bound to, the content guard that protects it and its labels. An unnamed field is kept as it came and every
// address is a same-origin path. The base URL is the one the server reports;
// it is never rebuilt from the base path.
const distributionSchema = z.looseObject({
  pulp_href: pulpHrefSchema,
  name: z.string(),
  base_path: z.string(),
  base_url: z.string().nullish(),
  repository: pulpHrefSchema.nullish(),
  publication: pulpHrefSchema.nullish(),
  repository_version: pulpHrefSchema.nullish(),
  content_guard: pulpHrefSchema.nullish(),
  pulp_labels: z.record(z.string(), z.string().nullable()).nullish(),
  pulp_created: z.string().nullish(),
  // A distribution that serves the content as of a point in time. Only plugins
  // with checkpoints have the field.
  checkpoint: z.boolean().nullish(),
});

type DistributionBase = z.infer<typeof distributionSchema>;

// The fields the index asks for: what the list cells, the filters and the
// dialogs that name the distributions of a repository read, and nothing else.
export const DISTRIBUTION_INDEX_FIELDS = [
  'pulp_href',
  'name',
  'base_path',
  'base_url',
  'repository',
  'publication',
  'repository_version',
  'content_guard',
  'pulp_labels',
  'pulp_created',
  'checkpoint',
] as const;

// How many distributions one request of the index reads: the most the server
// answers on one page.
const INDEX_PAGE_SIZE = 1000;

// How long the index is taken as current.
const INDEX_STALE_MS = 60_000;

// What a list of distributions is asked for, in the terms of a screen.
export interface DistributionListParams {
  page?: number;
  page_size?: number;
  sort?: string;
  name?: string;
  name__icontains?: string;
  base_path__icontains?: string;
  name__in?: string[];
  pulp_href__in?: string[];
  pulp_label_select?: string;
  // the address of a repository: only the distributions bound to it
  repository?: string;
  fields?: string[];
}

const TEXT_FILTERS = [
  'name',
  'name__icontains',
  'base_path__icontains',
  'pulp_label_select',
  'repository',
] as const;

// The three fields a distribution can be bound to what it serves: a
// repository (its latest version), a publication or one repository version.
export type BindingField = 'repository' | 'publication' | 'repository_version';

// The binding fields each plugin's distribution has. Plugins that serve
// versions directly have no publication field, and a body that named one would
// be refused or ignored.
export const DISTRIBUTION_BINDINGS: Readonly<
  Record<string, readonly BindingField[]>
> = {
  file: ['repository', 'publication', 'repository_version'],
  deb: ['repository', 'publication', 'repository_version'],
  rpm: ['repository', 'publication', 'repository_version'],
  python: ['repository', 'publication', 'repository_version'],
  maven: ['repository', 'repository_version'],
  npm: ['repository', 'repository_version'],
  ansible: ['repository', 'repository_version'],
  container: ['repository', 'repository_version'],
};

// What a distribution serves, as one new binding: exactly one of the fields,
// the address of the object to serve.
export type DistributionBinding = Partial<Record<BindingField, string>>;

// The body of a change of what a distribution serves: the new binding and null
// for every other binding field the plugin's distribution has, so the
// distribution is never left bound to two things. A binding the plugin has no
// field for, no binding and more than one binding are refused: each would send
// a body that does not say what the distribution should serve.
export function bindingChange(
  plugin: string,
  binding: DistributionBinding,
): Record<string, string | null> {
  const fields = Object.entries(DISTRIBUTION_BINDINGS).find(
    ([name]) => name === plugin,
  )?.[1];
  if (!fields) {
    throw new Error(`Unknown plugin ${plugin}: it has no distribution`);
  }
  const given = Object.entries(binding).filter(
    (entry): entry is [BindingField, string] => entry[1] !== undefined,
  );
  if (given.length !== 1) {
    throw new Error('A binding change names exactly one thing to serve');
  }
  const [[field, address]] = given as [[BindingField, string]];
  if (!fields.includes(field)) {
    throw new Error(`A ${plugin} distribution has no ${field} to bind`);
  }
  if (address === '') {
    throw new Error(`The ${field} to serve is empty`);
  }

  return Object.fromEntries(
    fields.map((name) => [name, name === field ? address : null]),
  );
}

// What a distribution is created with: the name, the path it is served under,
// what it serves and, when the caller chose one, a content guard and labels.
// A field that is not given is not sent.
export interface DistributionCreate extends DistributionBinding {
  name: string;
  base_path: string;
  // The address of a content guard; null is the explicit choice of no guard,
  // and leaving the field out leaves the choice to the server.
  content_guard?: string | null;
  pulp_labels?: Record<string, string>;
}

// The body of a create: the fields of the input that are given, and no other.
// Labels count as given when there is at least one.
export function distributionCreateBody(
  input: DistributionCreate,
): DistributionCreate {
  const { pulp_labels: labels, ...rest } = input;
  const given = Object.entries(rest).filter(([, value]) => value !== undefined);

  return {
    ...(Object.fromEntries(given) as unknown as DistributionCreate),
    ...(labels && Object.keys(labels).length > 0
      ? { pulp_labels: labels }
      : {}),
  };
}

// What a plugin's generated client offers for its distributions.
export interface DistributionApi<TListParams, TCreate, TUpdate> {
  list: (params?: TListParams, options?: Options) => Promise<unknown>;
  // The address a list with these parameters is requested from, as the client
  // builds it.
  listUrl: (params?: TListParams) => string;
  read: (
    href: string,
    params?: undefined,
    options?: Options,
  ) => Promise<unknown>;
  create: (body: TCreate, options?: Options) => Promise<unknown>;
  partialUpdate: (
    href: string,
    body: TUpdate,
    options?: Options,
  ) => Promise<unknown>;
  remove: (href: string, options?: Options) => Promise<unknown>;
  setLabel: (
    href: string,
    body: { key: string; value: string | null },
    options?: Options,
  ) => Promise<unknown>;
  unsetLabel: (
    href: string,
    body: { key: string },
    options?: Options,
  ) => Promise<unknown>;
}

export interface DistributionEntity<Row, TCreate, TUpdate> {
  readonly app: string;
  readonly object: 'distribution';
  list: (
    params?: DistributionListParams,
    options?: Options,
  ) => Promise<Page<Row>>;
  // The address a list of these parameters is requested from.
  urlOf: (params?: DistributionListParams) => string;
  retrieve: (href: string, options?: Options) => Promise<Row>;
  // Creates a distribution; resolves with the address of the task that does it.
  create: (body: TCreate, options?: Options) => Promise<string>;
  update: (
    href: string,
    body: TUpdate,
    options?: Options,
  ) => Promise<UpdateResult<Row>>;
  // Deletes a distribution; resolves with the address of the task that does
  // it.
  remove: (href: string, options?: Options) => Promise<string>;
  // Sets one label of a distribution; resolves with the label as the server
  // answers it.
  setLabel: (
    href: string,
    label: { key: string; value: string | null },
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
  // Removes one label of a distribution.
  unsetLabel: (
    href: string,
    key: string,
    options?: Options,
  ) => Promise<{ key: string; value?: string | null }>;
  // The address a client of the plugin uses to reach the distribution, or null
  // when the row names none.
  clientUrlOf: (row: Row) => string | null;
  // Every distribution of the plugin, read page after page with the fields of
  // DISTRIBUTION_INDEX_FIELDS. It ends when the server names no next page or a
  // page comes back empty (a list that shrank while it was read never loops).
  // Each page starts where the received rows end; a row that shows on two
  // pages because the list changed in between is kept once.
  index: (options?: Options) => Promise<Row[]>;
}

export function makeDistributionEntity<
  Row extends DistributionBase,
  TListParams,
  TCreate,
  TUpdate,
>({
  app,
  schema,
  api,
  clientUrl = (row) => row.base_url,
}: {
  app: string;
  schema: ZodType<Row>;
  api: DistributionApi<TListParams, TCreate, TUpdate>;
  // Where a client of the plugin reaches a distribution. Defaults to the base
  // URL of the row; a plugin that is reached elsewhere says where.
  clientUrl?: (row: Row) => string | null | undefined;
}): DistributionEntity<Row, TCreate, TUpdate> {
  const pageSchema = pageSchemaOf(schema);

  const requestOf = (params: DistributionListParams) =>
    asParams<TListParams>(toListRequest(params, TEXT_FILTERS));

  return {
    app,
    object: 'distribution',
    list: async (params = {}, options) => {
      if (matchesNothing(params)) {
        return EMPTY_PAGE;
      }
      const data = await api.list(requestOf(params), options);
      return parseResponse(pageSchema, data) as Page<Row>;
    },
    urlOf: (params = {}) => api.listUrl(requestOf(params)),
    retrieve: async (href, options) =>
      parseResponse(schema, await api.read(href, undefined, options)),
    create: async (body, options) => taskOf(await api.create(body, options)),
    update: async (href, body, options) =>
      parseUpdate(schema, await api.partialUpdate(href, body, options)),
    remove: async (href, options) => taskOf(await api.remove(href, options)),
    setLabel: async (href, label, options) =>
      parseResponse(
        labelResponseSchema,
        await api.setLabel(href, label, options),
      ),
    unsetLabel: async (href, key, options) =>
      parseResponse(
        labelResponseSchema,
        await api.unsetLabel(href, { key }, options),
      ),
    clientUrlOf: (row) => clientUrl(row) ?? null,
    index: async (options) => {
      const byHref = new Map<string, Row>();
      let received = 0;

      for (;;) {
        const data = await api.list(
          asParams<TListParams>({
            offset: received,
            limit: INDEX_PAGE_SIZE,
            fields: [...DISTRIBUTION_INDEX_FIELDS],
          }),
          options,
        );
        const next = parseResponse(pageSchema, data) as Page<Row>;
        for (const row of next.results) {
          byHref.set(row.pulp_href, row);
        }
        received += next.results.length;
        if (!next.next || next.results.length === 0) {
          return Array.from(byHref.values());
        }
      }
    },
  };
}

// The repository of each publication a distribution may be bound to, by the
// publication's address.
type PublicationRepositories = ReadonlyMap<string, string | null>;

// The repository a distribution serves: the one it is bound to, the one a
// version it is bound to belongs to, or the one a publication it is bound to
// was made from. Null when it is bound to nothing, or to a publication that is
// not known (yet).
function repositoryOfDistribution(
  row: DistributionBase,
  publications: PublicationRepositories,
): string | null {
  if (row.repository) {
    return row.repository;
  }
  if (row.repository_version) {
    return repositoryOfVersion(row.repository_version);
  }
  return row.publication ? (publications.get(row.publication) ?? null) : null;
}

// The base URLs that serve each repository, by the repository's address: for
// every distribution bound to a repository, to one of its versions or to one of
// its publications. A distribution with no base URL or bound to nothing is
// left out. The URLs of one repository are in alphabetical order.
export function baseUrlsByRepository(
  rows: readonly DistributionBase[],
  publications: PublicationRepositories,
): Map<string, string[]> {
  const urls = new Map<string, string[]>();

  for (const row of rows) {
    const repository = repositoryOfDistribution(row, publications);
    if (repository && row.base_url) {
      urls.set(repository, [...(urls.get(repository) ?? []), row.base_url]);
    }
  }
  for (const list of Array.from(urls.values())) {
    list.sort((a, b) => a.localeCompare(b));
  }

  return urls;
}

// The distributions that serve one repository, in the order of the index.
export function distributionsOfRepository<Row extends DistributionBase>(
  rows: readonly Row[],
  publications: PublicationRepositories,
  repository: string,
): Row[] {
  return rows.filter(
    (row) => repositoryOfDistribution(row, publications) === repository,
  );
}

// The repositories at least one of whose distributions has a base path that
// contains the text, ignoring case. An empty text matches every repository
// that has a distribution.
export function repositoriesMatchingBasePath(
  rows: readonly DistributionBase[],
  publications: PublicationRepositories,
  text: string,
): Set<string> {
  const needle = text.toLowerCase();
  const found = new Set<string>();

  for (const row of rows) {
    const repository = repositoryOfDistribution(row, publications);
    if (repository && row.base_path.toLowerCase().includes(needle)) {
      found.add(repository);
    }
  }

  return found;
}

export type DistributionIndexStatus = 'pending' | 'error' | 'success';

// What the index of a plugin's distributions offers once it has been read.
// Until then, and after a failed read, there is no answer: the views are
// undefined or null, never an empty map that would read as "nothing is served".
export interface DistributionIndex<Row> {
  status: DistributionIndexStatus;
  error: unknown;
  // Every distribution of the plugin; undefined until the index is complete.
  distributions: Row[] | undefined;
  baseUrlsByRepository: Map<string, string[]> | undefined;
  // The version number of each publication that a distribution is bound to and
  // the user can read, by the publication's address; undefined until the index
  // is complete. A publication the user cannot read is not in it.
  publicationVersions: ReadonlyMap<string, number | null> | undefined;
  // The distributions that serve a repository, or null while the index is not
  // complete.
  distributionsOfRepository: (repository: string) => Row[] | null;
  // The repositories a base path filter selects, or null while the index is not
  // complete.
  repositoriesMatchingBasePath: (text: string) => Set<string> | null;
  // Reads again what failed.
  retry: () => void;
}

// What the reads of publications settle to.
interface PublicationReads {
  repositories: Map<string, string | null>;
  // the version number of each publication, null when the address names none
  versions: Map<string, number | null>;
  status: DistributionIndexStatus;
  error: unknown;
}

// Folds the results of the publication reads into one answer. A function of
// its own, so its identity never changes between renders and the query layer
// reuses the answer while no read has changed.
function foldPublicationReads(
  results: {
    status: DistributionIndexStatus;
    data: PublicationBase[] | undefined;
    error: unknown;
  }[],
): PublicationReads {
  const repositories = new Map<string, string | null>();
  const versions = new Map<string, number | null>();
  let status: DistributionIndexStatus = 'success';
  let error: unknown = null;

  for (const result of results) {
    if (result.status === 'error') {
      status = 'error';
      error ??= result.error;
    } else if (result.status === 'pending' && status !== 'error') {
      status = 'pending';
    }
    for (const publication of result.data ?? []) {
      repositories.set(
        publication.pulp_href,
        repositoryOfPublication(publication),
      );
      versions.set(
        publication.pulp_href,
        versionNumberOf(publication.repository_version),
      );
    }
  }

  return { repositories, versions, status, error };
}

// The index of the distributions of a plugin, shared by every screen that
// shows where a repository is served: one read of every distribution (all
// pages), cached for a minute, plus the reads of the publications that
// publication-bound distributions point at, in chunks and never more than
// those. A plugin whose distributions are never bound to publications passes
// no publication entity. A second subscriber sends nothing.
export function useDistributionIndex<Row extends DistributionBase>(
  distribution: {
    readonly app: string;
    readonly object: 'distribution';
    index: (options?: Options) => Promise<Row[]>;
  },
  publication?: Pick<PublicationEntity<PublicationBase>, 'app' | 'object'> &
    Pick<PublicationEntity<PublicationBase>, 'chunks' | 'ofHrefs'>,
): DistributionIndex<Row> {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();
  const index = useSessionQuery({
    queryKey: entityKeys(distribution).index,
    queryFn: ({ signal }) => distribution.index({ signal }),
    staleTime: INDEX_STALE_MS,
  });

  const chunks = useMemo(() => {
    if (!publication || !index.data) {
      return [];
    }
    const bound = index.data.flatMap((row) =>
      row.publication ? [row.publication] : [],
    );
    return publication.chunks(bound);
  }, [publication, index.data]);

  const reads = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: publicationKeys(
        publication as { app: string; object: string },
      ).chunk(chunk),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        (publication as NonNullable<typeof publication>).ofHrefs(chunk, {
          signal,
        }),
      staleTime: Infinity,
      enabled: !ended,
    })),
    combine: foldPublicationReads,
  });

  const rows = index.data;
  const status: DistributionIndexStatus =
    index.status === 'error' || reads.status === 'error'
      ? 'error'
      : index.status === 'pending' || reads.status === 'pending'
        ? 'pending'
        : 'success';
  const ready = status === 'success' && rows !== undefined;
  const publications = reads.repositories;

  const byRepository = useMemo(
    () =>
      ready && rows ? baseUrlsByRepository(rows, publications) : undefined,
    [ready, rows, publications],
  );
  const ofRepository = useCallback(
    (repository: string) =>
      ready && rows
        ? distributionsOfRepository(rows, publications, repository)
        : null,
    [ready, rows, publications],
  );
  const matchingBasePath = useCallback(
    (text: string) =>
      ready && rows
        ? repositoriesMatchingBasePath(rows, publications, text)
        : null,
    [ready, rows, publications],
  );
  const { refetch: refetchIndex, status: indexStatus } = index;
  const retry = useCallback(() => {
    if (indexStatus === 'error') {
      void refetchIndex();
    }
    if (publication) {
      void queryClient.refetchQueries({
        queryKey: publicationKeys(publication).all,
        predicate: (query) => query.state.status === 'error',
      });
    }
  }, [indexStatus, refetchIndex, publication, queryClient]);

  return {
    status,
    error: index.error ?? reads.error,
    distributions: ready ? rows : undefined,
    baseUrlsByRepository: byRepository,
    publicationVersions: ready ? reads.versions : undefined,
    distributionsOfRepository: ofRepository,
    repositoriesMatchingBasePath: matchingBasePath,
    retry,
  };
}

// A distribution that serves a repository, and whether the content app answers
// with content for it.
export interface ServingDistribution<Row> {
  row: Row;
  served: boolean;
}

// What is known about how a repository is served, as plain facts for the rules
// that decide the state of each distribution (the entity never decides it).
export interface ServingFacts {
  // The number of the repository's latest version; null when it has none.
  latestVersion: number | null;
  // The version number of each publication of the repository the user can
  // read, one entry per publication. Empty when none was read, which a user
  // who may not read publications cannot tell from "there is none".
  publishedVersions: number[];
  // The version number of each publication that a distribution of the
  // repository is bound to, by the publication's address.
  publicationVersions: ReadonlyMap<string, number | null>;
}

export interface RepositoryDistributions<Row> {
  status: DistributionIndexStatus;
  error: unknown;
  // The distributions that serve the repository, in the order of the index;
  // undefined until they are all known.
  distributions: ServingDistribution<Row>[] | undefined;
  // The facts the state of each distribution is decided from; undefined until
  // they are all known.
  facts: ServingFacts | undefined;
  // Reads again what failed.
  retry: () => void;
}

// How long the publications of one repository are taken as current.
const REPOSITORY_PUBLICATIONS_STALE_MS = 30_000;

// The distributions that serve one repository (bound to it, to one of its
// publications or to one of its versions), each with whether it serves content.
// They are cut from the index of the plugin's distributions that every screen
// shares, so this adds no read of its own for them. Whether a distribution
// serves content needs the repository's publications: they are read once, and
// only when the plugin serves from publications and some distribution of the
// repository is not bound to a publication itself.
export function useRepositoryDistributions<Row extends DistributionBase>(
  distribution: {
    readonly app: string;
    readonly object: 'distribution';
    index: (options?: Options) => Promise<Row[]>;
  },
  publication:
    | {
        entity: PublicationEntity<PublicationBase>;
        servesFromPublication: boolean;
      }
    | undefined,
  repository: string,
  // The address of the repository's latest version, when it has one.
  latestVersionHref?: string | null,
): RepositoryDistributions<Row> {
  const index = useDistributionIndex(distribution, publication?.entity);
  const serving = publication?.servesFromPublication ?? false;
  const { distributionsOfRepository: ofRepository } = index;
  const own = useMemo(
    () => ofRepository(repository),
    [ofRepository, repository],
  );
  const needsPublications =
    serving && own !== null && own.some((row) => !row.publication);

  const publications = useSessionQuery({
    queryKey: publicationKeys(
      publication?.entity ?? { app: distribution.app, object: 'publication' },
    ).ofRepository(repository),
    queryFn: ({ signal }) =>
      (publication as NonNullable<typeof publication>).entity.ofRepository(
        repository,
        { signal },
      ),
    staleTime: REPOSITORY_PUBLICATIONS_STALE_MS,
    enabled: needsPublications,
  });

  const status: DistributionIndexStatus =
    index.status === 'error' || publications.status === 'error'
      ? 'error'
      : index.status === 'pending' ||
          (needsPublications && publications.status === 'pending')
        ? 'pending'
        : 'success';

  const distributions = useMemo(() => {
    if (status !== 'success' || own === null) {
      return undefined;
    }
    const known = (publications.data ?? []).map((row) => ({
      pulp_href: row.pulp_href,
      repository_version: row.repository_version,
    }));
    return own.map((row) => ({
      row,
      served: servedState(row, serving, known) === 'served',
    }));
  }, [status, own, publications.data, serving]);

  const { publicationVersions } = index;
  const facts = useMemo<ServingFacts | undefined>(() => {
    if (status !== 'success' || own === null || !publicationVersions) {
      return undefined;
    }
    return {
      latestVersion: versionNumberOf(latestVersionHref),
      publishedVersions: (publications.data ?? []).flatMap((row) => {
        const version = versionNumberOf(row.repository_version);
        return version === null ? [] : [version];
      }),
      publicationVersions,
    };
  }, [status, own, publicationVersions, publications.data, latestVersionHref]);

  const { refetch: refetchPublications, status: publicationsStatus } =
    publications;
  const retryIndex = index.retry;
  const retry = useCallback(() => {
    retryIndex();
    if (publicationsStatus === 'error') {
      void refetchPublications();
    }
  }, [retryIndex, publicationsStatus, refetchPublications]);

  return {
    status,
    error: index.error ?? publications.error,
    distributions,
    facts,
    retry,
  };
}

export { distributionSchema };
export type { DistributionBase };
