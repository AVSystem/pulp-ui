import {
  type QueryClient,
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSessionEnded } from 'src/session/session-events';
import { requestErrorStatus } from 'src/utilities/request-error';
import { RepositoryVersionClient } from './client';
import { type VersionSummary, contentCount } from './model';

const all = ['pulp', 'core', 'repository-version'] as const;

export const versionSummaryKeys = {
  all,
  // One version's summary, by its address. A version never changes, so what
  // was read is never read again.
  summary: (href: string) => [...all, 'summary', href] as const,
  summaries: [...all, 'summary'] as const,
  // One group of addresses, read with one request.
  chunk: (hrefs: readonly string[]) => [...all, 'chunk', hrefs] as const,
  chunks: [...all, 'chunk'] as const,
  // Whether the server answers a read of versions by address. Found out by the
  // first read of the session and kept in the cache.
  support: [...all, 'support'] as const,
};

type Support = { state: 'supported' } | { state: 'unsupported' };

// What the version summaries of a list are at the moment.
export interface VersionSummaries {
  // `unsupported`: the server cannot read versions by address, so the column
  // is not available and nothing more is asked. `loading`: reads are under way
  // or waiting. `error`: a read failed; `retry` asks again. `ready`: every
  // summary has been read.
  state: 'loading' | 'ready' | 'error' | 'unsupported';
  // The content count of each version read so far, by the version's address;
  // none for a version that is not read (yet) or that has no summary.
  counts: Map<string, number | null>;
  // Reads again what failed.
  retry: () => void;
}

// A version is a repository's latest one only for as long as the repository
// does not change; what a summary says never changes, so it is kept for good.
function keepForGood(queryClient: QueryClient) {
  queryClient.setQueryDefaults(versionSummaryKeys.summaries, {
    gcTime: Infinity,
    staleTime: Infinity,
  });
  queryClient.setQueryDefaults(versionSummaryKeys.support, {
    gcTime: Infinity,
    staleTime: Infinity,
  });
}

// Reads the summaries of one group of addresses: those the cache holds are
// taken from it, the others are read with one request and stored per address.
// The first group of a list is the probe. A refusal of that read, while
// nothing is known about the server, means the server cannot read versions by
// address; it is noted for the session and the other groups are never sent.
async function readGroup(
  queryClient: QueryClient,
  hrefs: string[],
  probe: boolean,
  signal: AbortSignal,
): Promise<VersionSummary[]> {
  keepForGood(queryClient);
  const known = (href: string) =>
    queryClient.getQueryData<VersionSummary>(versionSummaryKeys.summary(href));
  const missing = hrefs.filter((href) => known(href) === undefined);

  if (missing.length > 0) {
    try {
      const read = await RepositoryVersionClient.summaries(missing, { signal });
      for (const summary of read) {
        queryClient.setQueryData(
          versionSummaryKeys.summary(summary.pulp_href),
          summary,
        );
      }
    } catch (error) {
      if (
        probe &&
        requestErrorStatus(error) === 400 &&
        queryClient.getQueryData(versionSummaryKeys.support) === undefined
      ) {
        queryClient.setQueryData<Support>(versionSummaryKeys.support, {
          state: 'unsupported',
        });
      }
      throw error;
    }
  }
  if (
    probe &&
    queryClient.getQueryData(versionSummaryKeys.support) === undefined
  ) {
    queryClient.setQueryData<Support>(versionSummaryKeys.support, {
      state: 'supported',
    });
  }

  return hrefs.flatMap((href) => {
    const summary = known(href);
    return summary ? [summary] : [];
  });
}

interface GroupResult {
  status: 'pending' | 'error' | 'success';
  data: VersionSummary[] | undefined;
}

// Folds the results of the groups into one answer. A function of its own, so
// its identity never changes between renders and the query layer reuses the
// answer while no read has changed.
function foldGroups(results: GroupResult[]) {
  const counts = new Map<string, number | null>();
  let status: 'loading' | 'ready' | 'error' = 'ready';

  for (const result of results) {
    if (result.status === 'error') {
      status = 'error';
    } else if (result.status === 'pending' && status !== 'error') {
      status = 'loading';
    }
    for (const summary of result.data ?? []) {
      counts.set(summary.pulp_href, contentCount(summary));
    }
  }

  return { status, counts };
}

// The content counts of the latest versions of the rows of a list, read in
// groups of addresses with one request each, never one per row. The first group
// is sent alone: when the server refuses it, the server cannot read versions
// by address, the answer is `unsupported` for the rest of the session, and no
// other version request is ever sent. A null or empty address is a repository
// without a latest version and is not read. While the session has ended
// nothing is sent.
export function useVersionSummaries(
  hrefs: readonly (string | null | undefined)[],
): VersionSummaries {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();
  const support = useQuery<Support | undefined>({
    queryKey: versionSummaryKeys.support,
    queryFn: skipToken,
    gcTime: Infinity,
    staleTime: Infinity,
  }).data;

  const wanted = hrefs.filter((href): href is string => !!href).join('\n');
  const groups = useMemo(
    () => RepositoryVersionClient.chunks(wanted ? wanted.split('\n') : []),
    [wanted],
  );
  const unsupported = support?.state === 'unsupported';
  const none = useMemo(() => new Map<string, number | null>(), []);

  const folded = useQueries({
    queries: groups.map((group, position) => ({
      queryKey: versionSummaryKeys.chunk(group),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readGroup(queryClient, group, position === 0, signal),
      staleTime: Infinity,
      enabled:
        !ended &&
        !unsupported &&
        (position === 0 || support?.state === 'supported'),
    })),
    combine: foldGroups,
  });

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: versionSummaryKeys.chunks,
      predicate: (query) => query.state.status === 'error',
    });
  }, [queryClient]);

  return unsupported
    ? { state: 'unsupported', counts: none, retry }
    : { state: folded.status, counts: folded.counts, retry };
}
