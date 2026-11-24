import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskKeys } from 'src/entities/core/task/queries';
import { useSessionQuery } from 'src/query/use-session-query';
import type { Page, RepositoryVersion, VersionListParams } from './model';
import type { RemoteLookup, RemoteName } from './remote';
import type { Options, UpdateResult } from './request';

// The read hooks and mutations every plugin's repository and remote screens
// share. Each takes the entity (see makeRepositoryEntity and makeRemoteEntity)
// and keys what it reads by the entity's plugin and object, so two plugins
// never share a cache entry and one invalidation reads one object's lists
// again.

// What the hooks need of an entity to name its cache entries.
interface EntityName {
  readonly app: string;
  readonly object: string;
}

// The cache keys of one plugin's object: ['pulp', <plugin>, <object>, ...].
// `list` is one page of a list, `by-name` the lookup of a URL name and
// `detail` one object by its address and `index` the read of every object of
// the plugin that screens share. `versions` is a page of the versions of one
// repository, by the repository's address, and `version` one version of it by
// its number.
export function entityKeys(entity: EntityName) {
  const all = ['pulp', entity.app, entity.object] as const;

  return {
    all,
    list: (params: object) => [...all, 'list', params] as const,
    byName: (name: string) => [...all, 'by-name', name] as const,
    detail: (href: string) => [...all, 'detail', href] as const,
    index: [...all, 'index'] as const,
    versions: (repository: string, params: object) =>
      [...all, 'versions', repository, params] as const,
    version: (repository: string, number: number) =>
      [...all, 'version', repository, number] as const,
  };
}

// The parameters of a list apart from its page, in a form two lists can be
// compared by.
function withoutPage(params: object): string {
  return JSON.stringify(
    Object.entries(params)
      .filter(([key, value]) => key !== 'page' && value !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1)),
  );
}

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
export function otherPageOfSameList(
  a: { page?: number },
  b: { page?: number },
): boolean {
  return a.page !== b.page && withoutPage(a) === withoutPage(b);
}

interface ListableEntity<
  Row,
  Params extends { page?: number },
> extends EntityName {
  list: (params?: Params, options?: Options) => Promise<Page<Row>>;
}

// One page of a list. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads, the rows of the page before stay; rows that were read
// for other filters, another order or another page size are never shown in
// their place. False for `enabled` keeps the read off, for a screen that has
// nobody to read for.
export function useEntityList<Row, Params extends { page?: number }>(
  entity: ListableEntity<Row, Params>,
  params: Params,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const keys = entityKeys(entity);

  return useSessionQuery({
    queryKey: keys.list(params),
    queryFn: ({ signal }) => entity.list(params, { signal }),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      const before = key?.[4] as Params | undefined;
      const sameEntity = key?.[1] === entity.app && key?.[2] === entity.object;

      return before && sameEntity && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// How long the index of a plugin's repositories is taken as current.
const INDEX_STALE_MS = 30_000;

// Every repository of the plugin with the fields the filters need (address,
// name, remote and labels), read page after page and cached for the plugin.
// The read starts only when `enabled` is true, so a list that needs it
// sometimes pays for it only then. A second subscriber sends nothing.
export function useRepositoryIndex<Row>(
  entity: EntityName & {
    index: (options?: Options) => Promise<Row[]>;
  },
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: entityKeys(entity).index,
    queryFn: ({ signal }) => entity.index({ signal }),
    staleTime: INDEX_STALE_MS,
    enabled,
  });
}

// The object with this name, or null when there is none: the lookup a URL name
// turns into the object's address by. A null name is the name of nothing: no
// request is sent.
export function useEntityByName<Row>(
  entity: EntityName & {
    byName: (name: string, options?: Options) => Promise<Row | null>;
  },
  name: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: entityKeys(entity).byName(name ?? ''),
    queryFn: ({ signal }) => entity.byName(name as string, { signal }),
    enabled: enabled && name !== null,
  });
}

// One object by its address. A null address is the address of nothing: no
// request is sent.
export function useEntity<Row>(
  entity: EntityName & {
    retrieve: (href: string, options?: Options) => Promise<Row>;
  },
  href: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: entityKeys(entity).detail(href ?? ''),
    queryFn: ({ signal }) => entity.retrieve(href as string, { signal }),
    enabled: enabled && href !== null,
  });
}

// The remote at an address, named, whatever the type of the remote: the read a
// repository's Remote row is drawn from. It is one request for the address, and
// null for an address the list does not hold (a remote the user may not see, or
// one that was deleted). A null address reads nothing.
export function useRemoteByHref(
  lookup: Pick<RemoteLookup, 'app' | 'object' | 'byHrefs'>,
  href: string | null,
) {
  return useSessionQuery({
    queryKey: ['pulp', lookup.app, lookup.object, 'by-href', href ?? ''],
    queryFn: async ({ signal }): Promise<RemoteName | null> => {
      const found = await lookup.byHrefs([href as string], { signal });
      return found.find((row) => row.pulp_href === href) ?? null;
    },
    staleTime: INDEX_STALE_MS,
    enabled: href !== null,
  });
}

interface VersionedEntity extends EntityName {
  versions: (
    href: string,
    params?: VersionListParams,
    options?: Options,
  ) => Promise<Page<RepositoryVersion>>;
  versionByNumber: (
    href: string,
    number: number,
    options?: Options,
  ) => Promise<RepositoryVersion | null>;
}

// One page of the versions of a repository. Every set of parameters is a query
// of its own; while another page of the same list of the same repository loads,
// the rows of the page before stay, and rows of another repository, order or
// page size never stand in for it.
export function useRepositoryVersions(
  entity: VersionedEntity,
  repository: string,
  params: VersionListParams,
) {
  const keys = entityKeys(entity);

  return useSessionQuery({
    queryKey: keys.versions(repository, params),
    queryFn: ({ signal }) => entity.versions(repository, params, { signal }),
    placeholderData: (previous, previousQuery) => {
      const key = previousQuery?.queryKey;
      const before = key?.[5] as VersionListParams | undefined;
      const sameList =
        key?.[1] === entity.app &&
        key?.[2] === entity.object &&
        key?.[3] === 'versions' &&
        key?.[4] === repository;

      return before && sameList && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// The version of a repository with this number, or null when it has none. A
// number is a query of its own, so the answer for another number is never the
// one on screen. A version never changes once made, but it can be removed, so
// the answer is read again like any other after the usual stale time.
export function useRepositoryVersion(
  entity: VersionedEntity,
  repository: string,
  number: number,
) {
  return useSessionQuery({
    queryKey: entityKeys(entity).version(repository, number),
    queryFn: ({ signal }) =>
      entity.versionByNumber(repository, number, { signal }),
  });
}

// Every write below sends one request per call and is never repeated by
// itself: a repeated create or delete could do its work twice. Once the call
// has settled, whatever it answered, everything read of the object is read
// again, because the server may have changed something either way.
function useInvalidateOnSettle(entity: EntityName) {
  const queryClient = useQueryClient();

  return () =>
    queryClient.invalidateQueries({ queryKey: entityKeys(entity).all });
}

// Creates an object.
export function useCreateEntity<Body, Row>(
  entity: EntityName & {
    create: (body: Body, options?: Options) => Promise<Row>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: (body: Body) => entity.create(body),
    retry: false,
    onSettled: invalidate,
  });
}

export interface UpdateEntityRequest<Body> {
  // The address of the object to change.
  href: string;
  // The fields to change; a field that is not given is left as it is.
  body: Body;
}

// Changes some fields of an object. The answer says whether the server
// started a task or made the change at once.
export function useUpdateEntity<Body, Row>(
  entity: EntityName & {
    update: (
      href: string,
      body: Body,
      options?: Options,
    ) => Promise<UpdateResult<Row>>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: ({ href, body }: UpdateEntityRequest<Body>) =>
      entity.update(href, body),
    retry: false,
    onSettled: invalidate,
  });
}

export interface DeleteEntityRequest {
  // The address of the object to delete.
  href: string;
}

// Deletes an object. The answer is the address of the task that deletes it.
export function useDeleteEntity(
  entity: EntityName & {
    remove: (href: string, options?: Options) => Promise<string>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: ({ href }: DeleteEntityRequest) => entity.remove(href),
    retry: false,
    onSettled: invalidate,
  });
}

export interface SetLabelRequest {
  // The address of the object that carries the label.
  href: string;
  key: string;
  // The value to set; null sets a label with no value.
  value: string | null;
}

// Sets one label of an object, with one request.
export function useSetLabel(
  entity: EntityName & {
    setLabel: (
      href: string,
      label: { key: string; value: string | null },
      options?: Options,
    ) => Promise<unknown>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: ({ href, key, value }: SetLabelRequest) =>
      entity.setLabel(href, { key, value }),
    retry: false,
    onSettled: invalidate,
  });
}

export interface UnsetLabelRequest {
  // The address of the object that carries the label.
  href: string;
  key: string;
}

// Removes one label of an object, with one request.
export function useUnsetLabel(
  entity: EntityName & {
    unsetLabel: (
      href: string,
      key: string,
      options?: Options,
    ) => Promise<unknown>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: ({ href, key }: UnsetLabelRequest) =>
      entity.unsetLabel(href, key),
    retry: false,
    onSettled: invalidate,
  });
}

export interface ModifyRepositoryRequest<Body> {
  // The address of the repository whose content changes.
  href: string;
  // What changes: a version to take the content of, or units to add and remove.
  body: Body;
}

// Changes the content of a repository, which the server does in a task of its
// own. The answer is the address of that task. The versions read before are
// read again once the call has settled, whatever it answered.
export function useModifyRepository<Body>(
  entity: EntityName & {
    modify?: (href: string, body: Body, options?: Options) => Promise<string>;
  },
) {
  const invalidate = useInvalidateOnSettle(entity);

  return useMutation({
    mutationFn: ({ href, body }: ModifyRepositoryRequest<Body>) => {
      if (!entity.modify) {
        throw new Error('The plugin has no way to change repository content');
      }
      return entity.modify(href, body);
    },
    retry: false,
    onSettled: invalidate,
  });
}

export interface SyncRepositoryRequest<Body> {
  // The address of the repository to sync.
  href: string;
  // What the sync is asked for: the remote and the options of the plugin.
  body: Body;
}

// Starts a sync, which the server runs in a task of its own. The answer is the
// address of that task. The call is never repeated by itself: a repeated sync
// would queue a second one. Once it has settled, whatever it answered, the task
// the repository now holds and the tasks every list shows are read again, so a
// sync that has just started shows without waiting for the next scheduled read.
export function useSyncRepository<Body>(
  entity: EntityName & {
    sync?: (href: string, body: Body, options?: Options) => Promise<string>;
  },
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href, body }: SyncRepositoryRequest<Body>) => {
      if (!entity.sync) {
        throw new Error('The plugin has no way to sync a repository');
      }
      return entity.sync(href, body);
    },
    retry: false,
    onSettled: (_task, _error, { href }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.index });
      void queryClient.invalidateQueries({
        queryKey: taskKeys.activeOf(href),
      });
    },
  });
}

export interface PublishRequest<Body> {
  // The address of the repository the publication is made from; the tasks the
  // repository holds are read again once the request has settled.
  repository: string;
  // What is published: the repository (its latest version) or one version, and
  // the options of the plugin.
  body: Body;
}

// Starts a publish, which the server runs in a task of its own. The answer is
// the address of that task. The call is never repeated by itself: a repeated
// publish would make a second publication. Once it has settled, whatever it
// answered, the task the repository now holds and the tasks every list shows
// are read again, so a publish that has just started shows without waiting for
// the next scheduled read.
export function usePublish<Body>(entity: {
  create?: (body: Body, options?: Options) => Promise<string>;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ body }: PublishRequest<Body>) => {
      if (!entity.create) {
        throw new Error('The plugin has no way to publish a repository');
      }
      return entity.create(body);
    },
    retry: false,
    onSettled: (_task, _error, { repository }) => {
      void queryClient.invalidateQueries({ queryKey: taskKeys.index });
      void queryClient.invalidateQueries({
        queryKey: taskKeys.activeOf(repository),
      });
    },
  });
}
