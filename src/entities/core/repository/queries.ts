import { useCallback, useMemo } from 'react';
import { useSessionQuery } from 'src/query/use-session-query';
import { useChunkedRead } from '../chunked-read';
import { RepositoryClient, type RepositoryRef } from './client';

export const repositoryRefKeys = {
  all: ['pulp', 'core', 'repository'] as const,
  // One group of repositories at known addresses, read with one request.
  chunk: (hrefs: readonly string[]) =>
    [...repositoryRefKeys.all, 'chunk', hrefs] as const,
  // The repositories of one plugin found by a search for a text; every text is
  // a read of its own.
  search: (plugin: string, text: string) =>
    [...repositoryRefKeys.all, 'search', plugin, text] as const,
  // The repository of one plugin with this name.
  byName: (plugin: string, name: string) =>
    [...repositoryRefKeys.all, 'by-name', plugin, name] as const,
};

export interface RepositoriesByHref {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  // The repositories the user may read, by address; undefined until every
  // group is read. An address that is not in it names a repository that is
  // not readable.
  repositories: ReadonlyMap<string, RepositoryRef> | undefined;
  // Reads again the groups that failed.
  retry: () => void;
}

// The repositories at these addresses, whatever their plugin: one read for each
// group of addresses the URL budget allows and never one for a repository.
export function useRepositoriesByHref(
  hrefs: readonly string[],
): RepositoriesByHref {
  const chunks = useMemo(() => RepositoryClient.chunks(hrefs), [hrefs]);
  const keyOf = useCallback(
    (chunk: string[]) => repositoryRefKeys.chunk(chunk),
    [],
  );
  const read = useCallback(
    (chunk: string[], options: { signal: AbortSignal }) =>
      RepositoryClient.byHrefs(chunk, options),
    [],
  );
  const { status, error, rows, retry } = useChunkedRead({
    chunks,
    keyOf,
    read,
  });

  return { status, error, repositories: rows, retry };
}

// The repositories of the plugin whose name holds the text: one page and the
// number that match in all. A failure is the query's error and never an empty
// list.
export function useRepositorySearch(plugin: string, text: string) {
  return useSessionQuery({
    queryKey: repositoryRefKeys.search(plugin, text),
    queryFn: ({ signal }) => RepositoryClient.search(plugin, text, { signal }),
    staleTime: 30_000,
    retry: false,
  });
}

// The repository of the plugin with this name, or null. A null name reads
// nothing.
export function useRepositoryByName(plugin: string, name: string | null) {
  return useSessionQuery({
    queryKey: repositoryRefKeys.byName(plugin, name ?? ''),
    queryFn: ({ signal }) =>
      RepositoryClient.byName(plugin, name as string, { signal }),
    enabled: name !== null,
    staleTime: 30_000,
  });
}
