import { useCallback, useMemo } from 'react';
import { useChunkedRead } from '../chunked-read';
import { RepositoryClient, type RepositoryRef } from './client';

export const repositoryRefKeys = {
  all: ['pulp', 'core', 'repository'] as const,
  // One group of repositories at known addresses, read with one request.
  chunk: (hrefs: readonly string[]) =>
    [...repositoryRefKeys.all, 'chunk', hrefs] as const,
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
