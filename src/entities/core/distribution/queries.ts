import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { otherPageOfSameList } from 'src/entities/plugin/queries';
import { useSessionQuery } from 'src/query/use-session-query';
import { useSessionEnded } from 'src/session/session-events';
import {
  type DistributionPageParams,
  type EnrichmentChunk,
  type ListedDistribution,
  distributionPage,
  enrichmentChunks,
  readEnrichment,
} from './page';

export const distributionPageKeys = {
  all: ['pulp', 'core', 'distribution'] as const,
  // One page of the cross-plugin list.
  page: (params: DistributionPageParams) =>
    [...distributionPageKeys.all, 'page', params] as const,
  // The client addresses of one group of rows of one plugin; a plugin's own
  // reads are keyed by the plugin so a write of that plugin's distributions
  // reads them again.
  urls: ({ plugin, hrefs }: EnrichmentChunk) =>
    ['pulp', plugin, 'distribution', 'urls', hrefs] as const,
};

// How long a page of the list is taken as current.
const PAGE_STALE_MS = 30_000;

// One page of the cross-plugin list. Every set of parameters is a query of its
// own; while another page of the same list loads, the rows of the page before
// stay, and rows read for another order, page size or set of plugins never
// stand in for it.
export function useDistributionPage(params: DistributionPageParams) {
  return useSessionQuery({
    queryKey: distributionPageKeys.page(params),
    queryFn: ({ signal }) => distributionPage(params, { signal }),
    staleTime: PAGE_STALE_MS,
    placeholderData: (previous, previousQuery) => {
      const before =
        previousQuery?.queryKey[3] === 'page'
          ? (previousQuery.queryKey[4] as DistributionPageParams | undefined)
          : undefined;

      return before && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

export type UrlReadStatus = 'pending' | 'error' | 'success';

// Where a client reaches each row of a page: the address by the row's own
// address, null for a row whose plugin names none. Until every group is read
// there is no map, so a missing address is never taken for "none".
export interface DistributionUrls {
  status: UrlReadStatus;
  error: unknown;
  urls: ReadonlyMap<string, string | null> | undefined;
  // Reads again the groups that failed.
  retry: () => void;
}

interface Reads {
  status: UrlReadStatus;
  error: unknown;
  urls: Map<string, string | null>;
  // the groups that are in error, by their position
  failed: number[];
}

// Folds the results of the group reads into one answer. A function of its own,
// so its identity never changes between renders.
function fold(
  results: {
    status: UrlReadStatus;
    data: [string, string | null][] | undefined;
    error: unknown;
  }[],
): Reads {
  const urls = new Map<string, string | null>();
  const failed: number[] = [];
  let status: UrlReadStatus = 'success';
  let error: unknown = null;

  results.forEach((result, position) => {
    if (result.status === 'error') {
      status = 'error';
      error ??= result.error;
      failed.push(position);
    } else if (result.status === 'pending' && status !== 'error') {
      status = 'pending';
    }
    for (const [href, url] of result.data ?? []) {
      urls.set(href, url);
    }
  });

  return { status, error, urls, failed };
}

// The client addresses of the rows of a page: one read for each group of rows
// of one plugin, as many groups as the URL budget makes of the page and never
// one read for a row.
export function useDistributionUrls(
  rows: readonly ListedDistribution[],
): DistributionUrls {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();
  const chunks = useMemo(() => enrichmentChunks(rows), [rows]);

  const reads = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: distributionPageKeys.urls(chunk),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readEnrichment(chunk, { signal }),
      staleTime: PAGE_STALE_MS,
      enabled: !ended,
    })),
    combine: fold,
  });

  const { failed } = reads;
  const retry = useCallback(() => {
    for (const position of failed) {
      const chunk = chunks[position];
      if (chunk) {
        void queryClient.refetchQueries({
          queryKey: distributionPageKeys.urls(chunk),
        });
      }
    }
  }, [chunks, failed, queryClient]);

  return {
    status: reads.status,
    error: reads.error,
    urls: reads.status === 'success' ? reads.urls : undefined,
    retry,
  };
}
