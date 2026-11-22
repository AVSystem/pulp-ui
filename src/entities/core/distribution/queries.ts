import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { otherPageOfSameList } from 'src/entities/plugin/queries';
import { useSessionQuery } from 'src/query/use-session-query';
import { useSessionEnded } from 'src/session/session-events';
import {
  type DistributionFacts,
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
  // What one group of rows of one plugin says of itself; a plugin's own reads
  // are keyed by the plugin so a write of that plugin's distributions reads
  // them again.
  facts: ({ plugin, hrefs }: EnrichmentChunk) =>
    ['pulp', plugin, 'distribution', 'facts', hrefs] as const,
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

// What each row of a page says of itself beyond the core list: where a client
// reaches it, the publication it is bound to and whether it serves by
// checkpoint, by the row's own address. Until every group is read there is no
// map, so a missing entry is never taken for "none".
export interface DistributionFactsRead {
  status: UrlReadStatus;
  error: unknown;
  facts: ReadonlyMap<string, DistributionFacts> | undefined;
  // Reads again the groups that failed.
  retry: () => void;
}

interface Reads {
  status: UrlReadStatus;
  error: unknown;
  facts: Map<string, DistributionFacts>;
  // the groups that are in error, by their position
  failed: number[];
}

// Folds the results of the group reads into one answer. A function of its own,
// so its identity never changes between renders.
function fold(
  results: {
    status: UrlReadStatus;
    data: [string, DistributionFacts][] | undefined;
    error: unknown;
  }[],
): Reads {
  const facts = new Map<string, DistributionFacts>();
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
    for (const [href, row] of result.data ?? []) {
      facts.set(href, row);
    }
  });

  return { status, error, facts, failed };
}

// What the plugins say of the rows of a page: one read for each group of rows of
// one plugin, as many groups as the URL budget makes of the page and never one
// read for a row.
export function useDistributionFacts(
  rows: readonly ListedDistribution[],
): DistributionFactsRead {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();
  const chunks = useMemo(() => enrichmentChunks(rows), [rows]);

  const reads = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: distributionPageKeys.facts(chunk),
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
          queryKey: distributionPageKeys.facts(chunk),
        });
      }
    }
  }, [chunks, failed, queryClient]);

  return {
    status: reads.status,
    error: reads.error,
    facts: reads.status === 'success' ? reads.facts : undefined,
    retry,
  };
}
