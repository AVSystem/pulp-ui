import { useMemo } from 'react';
import type { Page, RepositoryListParams } from 'src/entities/plugin/model';
import { entityKeys, useEntityList } from 'src/entities/plugin/queries';
import type { RepositoryEntity } from 'src/entities/plugin/repository';
import { useSessionQuery } from 'src/query/use-session-query';

// How long the rows of a base path that needed several reads are taken as
// current.
const MERGED_STALE_MS = 30_000;

// The repositories a base path filter selects, as the distribution index
// answers.
export interface BasePathSelection {
  // The text of the filter, or undefined when the list has no base path filter.
  text: string | undefined;
  // The addresses of the repositories a distribution with such a base path
  // serves, or null while the index is not complete.
  matches: ReadonlySet<string> | null;
  // How the index read stands, with its error and the way to read it again.
  status: 'pending' | 'error' | 'success';
  error: unknown;
  retry: () => void;
}

// What the list needs of the rows it shows, whichever way they were read.
export interface RepositoryRows<Row> {
  data: Page<Row> | undefined;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isPlaceholderData: boolean;
  isRefetchError: boolean;
  errorUpdatedAt: number;
  refetch: () => unknown;
  // How many repositories the base path filter selected, or null when there is
  // none.
  baseMatches: number | null;
}

// The filters of a request apart from the ones that cut it into a page, which
// is what the reads of a merged set share.
const PAGING = ['page', 'page_size', 'sort'];

function filtersOf(request: RepositoryListParams): RepositoryListParams {
  return Object.fromEntries(
    Object.entries(request).filter(([key]) => !PAGING.includes(key)),
  );
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

// Orders rows by the field of an address's sort, a leading minus sorting down,
// and by name where two rows tie.
function sortedBy<Row extends { name: string }>(
  rows: readonly Row[],
  sort: string | undefined,
): Row[] {
  const down = sort?.startsWith('-') ?? false;
  const field = down ? (sort ?? '').slice(1) : (sort ?? 'name');
  const value = (row: Row) =>
    String((row as Record<string, unknown>)[field] ?? '');

  return [...rows].sort((a, b) => {
    const order = value(a).localeCompare(value(b));
    const result = order !== 0 ? order : a.name.localeCompare(b.name);
    return down ? -result : result;
  });
}

// The page of repositories a list shows. Without a base path filter this is
// one server-paged read of the request. A base path is not a field of a
// repository: it selects repositories through the distributions that serve
// them, so the selected addresses are sent as `pulp_href__in` together with the
// other filters. When one request holds them all, the server pages and orders as
// usual. When they need several, every chunk is read once, the rows are merged,
// ordered and paged here, and a later page or order is cut from what is held
// with no further request. While the distribution index is not complete nothing
// is read, and a failed index is the failure of the list, with the index's own
// way to read again.
export function useRepositoryRows<Row extends { name: string }>(
  entity: RepositoryEntity<Row, never, never, never, never>,
  request: RepositoryListParams,
  basePath: BasePathSelection,
): RepositoryRows<Row> {
  const filtering = basePath.text !== undefined;
  const hrefs = useMemo(
    () =>
      filtering && basePath.matches
        ? Array.from(basePath.matches).sort()
        : null,
    [filtering, basePath.matches],
  );

  // Measured with every filter but not with the page or order, so the way the
  // rows are read does not change when only those do.
  const filters = useMemo(() => filtersOf(request), [request]);
  const chunks = useMemo(
    () => (hrefs ? entity.chunks(hrefs, { ...filters, page_size: 1000 }) : []),
    [entity, hrefs, filters],
  );
  const merged = chunks.length > 1;

  // One request: the server pages. No selected repository is a read of
  // nothing, which the entity answers with an empty page.
  const direct = useEntityList(
    entity,
    hrefs && !merged ? { ...request, pulp_href__in: chunks[0] ?? [] } : request,
    { enabled: !filtering || (hrefs !== null && !merged) },
  );

  const all = useSessionQuery({
    queryKey: [
      ...entityKeys(entity).all,
      'list',
      { ...filters, selected: fingerprint(hrefs ?? []) },
    ],
    queryFn: ({ signal }) => entity.readChunks(chunks, filters, { signal }),
    enabled: merged,
    staleTime: MERGED_STALE_MS,
  });

  const page = request.page ?? 1;
  const size = request.page_size ?? 50;
  const sort = request.sort;
  const mergedPage = useMemo<Page<Row> | undefined>(() => {
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

  const baseMatches = filtering ? (basePath.matches?.size ?? null) : null;

  if (filtering && basePath.status === 'error') {
    return {
      data: undefined,
      isError: true,
      error: basePath.error,
      isFetching: false,
      isPlaceholderData: false,
      isRefetchError: false,
      errorUpdatedAt: 0,
      refetch: basePath.retry,
      baseMatches,
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
      baseMatches,
    };
  }
  return {
    data: filtering && !hrefs ? undefined : direct.data,
    isError: direct.isError,
    error: direct.error,
    isFetching: direct.isFetching || (filtering && !hrefs),
    isPlaceholderData: direct.isPlaceholderData,
    isRefetchError: direct.isRefetchError,
    errorUpdatedAt: direct.errorUpdatedAt,
    refetch: direct.refetch,
    baseMatches,
  };
}
