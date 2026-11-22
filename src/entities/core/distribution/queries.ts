import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import {
  INDEX_STALE_MS,
  publicDistributions,
} from 'src/entities/plugin/distribution';
import type { Page } from 'src/entities/plugin/model';
import { entityKeys, otherPageOfSameList } from 'src/entities/plugin/queries';
import { useSessionQuery } from 'src/query/use-session-query';
import { useSessionEnded } from 'src/session/session-events';
import {
  DISTRIBUTION_ENTITIES,
  type DistributionFacts,
  type DistributionFilters,
  type DistributionPageParams,
  type DistributionPlugin,
  type EnrichmentChunk,
  type ListedDistribution,
  distributionChunks,
  distributionPage,
  enrichmentChunks,
  readDistributionChunks,
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

// How long the rows of a set of addresses that needed several reads are taken
// as current.
const MERGED_STALE_MS = 30_000;

// One page of the cross-plugin list. Every set of parameters is a query of its
// own; while another page of the same list loads, the rows of the page before
// stay, and rows read for another order, page size or set of plugins never
// stand in for it.
export function useDistributionPage(
  params: DistributionPageParams,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: distributionPageKeys.page(params),
    queryFn: ({ signal }) => distributionPage(params, { signal }),
    staleTime: PAGE_STALE_MS,
    enabled,
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

export type PublicDistributionsStatus = 'pending' | 'error' | 'success';

// The addresses of the distributions that have no content guard, across some
// plugins.
export interface PublicDistributions {
  status: PublicDistributionsStatus;
  error: unknown;
  // Every public distribution of the plugins; null until the index of every
  // plugin has been read, so a plugin that has not answered is never taken for
  // one that has none.
  hrefs: string[] | null;
  // Reads again the indexes that failed.
  retry: () => void;
}

// Folds the results of the plugins' index reads into one answer. A function of
// its own, so its identity never changes between renders.
function foldIndexes(
  results: {
    status: PublicDistributionsStatus;
    data: Parameters<typeof publicDistributions>[0] | undefined;
    error: unknown;
  }[],
): Omit<PublicDistributions, 'retry'> {
  let status: PublicDistributionsStatus = 'success';
  let error: unknown = null;

  for (const result of results) {
    if (result.status === 'error') {
      status = 'error';
      error ??= result.error;
    } else if (result.status === 'pending' && status !== 'error') {
      status = 'pending';
    }
  }

  return {
    status,
    error,
    hrefs:
      status === 'success'
        ? results.flatMap(({ data }) => publicDistributions(data ?? []))
        : null,
  };
}

// The distributions of the plugins that have no content guard, from the index
// of each plugin's distributions that every screen shares (cached for a
// minute, so the base path filter of a repository list and this one read it
// once between them). Nothing is read while `enabled` is false.
export function usePublicDistributions(
  plugins: readonly DistributionPlugin[],
  enabled: boolean,
): PublicDistributions {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();

  const reads = useQueries({
    queries: plugins.map((plugin) => {
      const entity = DISTRIBUTION_ENTITIES[plugin];

      return {
        queryKey: entityKeys(entity).index,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          entity.index({ signal }),
        staleTime: INDEX_STALE_MS,
        enabled: enabled && !ended,
      };
    }),
    combine: foldIndexes,
  });

  const retry = useCallback(() => {
    for (const plugin of plugins) {
      void queryClient.refetchQueries({
        queryKey: entityKeys(DISTRIBUTION_ENTITIES[plugin]).index,
        predicate: (query) => query.state.status === 'error',
      });
    }
  }, [plugins, queryClient]);

  return { ...reads, retry };
}

// The public distributions a list is narrowed to, as the indexes answer.
export interface PublicSelection {
  // Whether the list is narrowed to them at all.
  enabled: boolean;
  // Their addresses, or null while the indexes are not complete.
  hrefs: readonly string[] | null;
  // How the indexes stand, with the error and the way to read them again.
  status: PublicDistributionsStatus;
  error: unknown;
  retry: () => void;
}

// What the list needs of the rows it shows, whichever way they were read.
export interface DistributionRows {
  data: Page<ListedDistribution> | undefined;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isRefetchError: boolean;
  errorUpdatedAt: number;
  refetch: () => unknown;
}

// A short text that differs when the addresses differ, to key a read by them
// without holding thousands of addresses in a key.
function fingerprint(values: readonly string[]): string {
  let hash = 5381;
  for (const value of values) {
    for (let at = 0; at < value.length; at += 1) {
      hash = ((hash * 33) ^ value.charCodeAt(at)) >>> 0;
    }
    hash = ((hash * 33) ^ 44) >>> 0;
  }
  return `${values.length}:${hash.toString(36)}`;
}

// The value a row is ordered by, for the fields the list can be ordered by.
function orderValue(row: ListedDistribution, field: string): string {
  switch (field) {
    case 'pulp_type':
      return row.plugin ?? row.typeName;
    case 'base_path':
      return row.base_path;
    case 'pulp_created':
      return row.pulp_created ?? '';
    default:
      return row.name;
  }
}

// Orders rows by the field of an address's sort, a leading minus sorting down,
// and by name where two rows tie.
function sortedBy(
  rows: readonly ListedDistribution[],
  sort: string | undefined,
): ListedDistribution[] {
  const down = sort?.startsWith('-') ?? false;
  const field = down ? (sort ?? '').slice(1) : (sort ?? 'name');

  return [...rows].sort((a, b) => {
    const order = orderValue(a, field).localeCompare(orderValue(b, field));
    const result = order !== 0 ? order : a.name.localeCompare(b.name);

    return down ? -result : result;
  });
}

// The parameters of a request that cut it into a page or name its addresses.
const PAGING = ['page', 'page_size', 'sort', 'pulp_href__in'];

// The filters of a request apart from those.
function filtersOf(request: DistributionPageParams): DistributionFilters {
  return Object.fromEntries(
    Object.entries(request).filter(([key]) => !PAGING.includes(key)),
  ) as unknown as DistributionFilters;
}

// The page of distributions a list shows. Without the public filter this is one
// server-paged read of the request. With it, the addresses of the distributions
// that have no content guard are sent as `pulp_href__in` together with the other
// filters. When one request holds them all, the server pages and orders as
// usual. When they need several, every group is read once, the rows are merged,
// ordered and paged here, and a later page or order is cut from what is held
// with no further request. The way the rows are read is decided by the filters
// alone, never by the page or the order. While the indexes are not complete
// nothing is read, and a failed index is the failure of the list, with the
// index's own way to read again.
export function useDistributionRows(
  request: DistributionPageParams,
  selection: PublicSelection,
): DistributionRows {
  const filtering = selection.enabled;
  const hrefs = useMemo(
    () =>
      filtering && selection.hrefs ? Array.from(selection.hrefs).sort() : null,
    [filtering, selection.hrefs],
  );

  const filters = useMemo(() => filtersOf(request), [request]);
  const chunks = useMemo(
    () => (hrefs ? distributionChunks(hrefs, filters) : []),
    [hrefs, filters],
  );
  const merged = chunks.length > 1;

  // One request: the server pages. No public distribution is a read of
  // nothing, which the page answers with an empty list.
  const direct = useDistributionPage(
    hrefs && !merged ? { ...request, pulp_href__in: chunks[0] ?? [] } : request,
    { enabled: !filtering || (hrefs !== null && !merged) },
  );
  const asked = useMemo(() => new Set(chunks[0] ?? []), [chunks]);
  const directData = useMemo(
    () =>
      direct.data && hrefs
        ? {
            ...direct.data,
            results: direct.data.results.filter((row) =>
              asked.has(row.pulp_href),
            ),
          }
        : direct.data,
    [direct.data, hrefs, asked],
  );

  const all = useSessionQuery({
    queryKey: [
      ...distributionPageKeys.all,
      'merged',
      { ...filters, selected: fingerprint(hrefs ?? []) },
    ],
    queryFn: ({ signal }) =>
      readDistributionChunks(chunks, filters, { signal }),
    enabled: merged,
    staleTime: MERGED_STALE_MS,
  });

  const page = request.page ?? 1;
  const size = request.page_size ?? 50;
  const { sort } = request;
  const mergedPage = useMemo<Page<ListedDistribution> | undefined>(() => {
    if (!all.data) {
      return undefined;
    }
    const rows = sortedBy(all.data, sort);

    return {
      count: rows.length,
      next: null,
      previous: null,
      results: rows.slice((page - 1) * size, page * size),
    };
  }, [all.data, sort, page, size]);

  if (filtering && selection.status === 'error') {
    return {
      data: undefined,
      isError: true,
      error: selection.error,
      isFetching: false,
      isPlaceholderData: false,
      isRefetchError: false,
      errorUpdatedAt: 0,
      refetch: selection.retry,
    };
  }
  if (merged) {
    return {
      data: mergedPage,
      isError: all.isError,
      error: all.error,
      isFetching: all.isFetching,
      isPlaceholderData: false,
      isRefetchError: all.isRefetchError,
      errorUpdatedAt: all.errorUpdatedAt,
      refetch: all.refetch,
    };
  }

  const waiting = filtering && !hrefs;

  return {
    data: waiting ? undefined : directData,
    isError: direct.isError,
    error: direct.error,
    isFetching: direct.isFetching || waiting,
    isPlaceholderData: !waiting && direct.isPlaceholderData,
    isRefetchError: direct.isRefetchError,
    errorUpdatedAt: direct.errorUpdatedAt,
    refetch: direct.refetch,
  };
}
