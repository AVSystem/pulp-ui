import {
  type QueryKey,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSessionEnded } from 'src/session/session-events';

// The rows of a read that is cut into groups of addresses, one request for
// each group, shared by the screens that need it. Until every group is read
// there are no rows, so a row that is missing is never taken for one that does
// not exist.
export interface ChunkedRead<Row> {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  rows: ReadonlyMap<string, Row> | undefined;
  // Reads again the groups that failed.
  retry: () => void;
}

// How long the rows of a read are taken as current.
const STALE_MS = 30_000;

interface Fold<Row> {
  status: ChunkedRead<Row>['status'];
  error: unknown;
  rows: Map<string, Row>;
  failed: number[];
}

// Folds the results of the group reads into one answer. A function of its own,
// so its identity never changes between renders.
function fold<Row extends { pulp_href: string }>(
  results: {
    status: 'pending' | 'error' | 'success';
    data: Row[] | undefined;
    error: unknown;
  }[],
): Fold<Row> {
  const rows = new Map<string, Row>();
  const failed: number[] = [];
  let status: Fold<Row>['status'] = 'success';
  let error: unknown = null;

  results.forEach((result, position) => {
    if (result.status === 'error') {
      status = 'error';
      error ??= result.error;
      failed.push(position);
    } else if (result.status === 'pending' && status !== 'error') {
      status = 'pending';
    }
    for (const row of result.data ?? []) {
      rows.set(row.pulp_href, row);
    }
  });

  return { status, error, rows, failed };
}

// Reads the groups of `chunks` with one query each, keyed by `keyOf`, and folds
// them into one answer by address. Nothing is read for no groups, and the read
// is left alone while the session has ended.
export function useChunkedRead<Row extends { pulp_href: string }>({
  chunks,
  keyOf,
  read,
}: {
  chunks: readonly string[][];
  keyOf: (chunk: string[]) => QueryKey;
  read: (chunk: string[], options: { signal: AbortSignal }) => Promise<Row[]>;
}): ChunkedRead<Row> {
  const queryClient = useQueryClient();
  const { ended } = useSessionEnded();

  const reads = useQueries({
    queries: chunks.map((chunk) => ({
      queryKey: keyOf(chunk),
      queryFn: ({ signal }: { signal: AbortSignal }) => read(chunk, { signal }),
      staleTime: STALE_MS,
      enabled: !ended,
    })),
    combine: fold<Row>,
  });

  const { failed } = reads;
  const retry = useCallback(() => {
    for (const position of failed) {
      const chunk = chunks[position];
      if (chunk) {
        void queryClient.refetchQueries({ queryKey: keyOf(chunk) });
      }
    }
  }, [chunks, failed, keyOf, queryClient]);

  return useMemo(
    () => ({
      status: reads.status,
      error: reads.error,
      rows: reads.status === 'success' ? reads.rows : undefined,
      retry,
    }),
    [reads.status, reads.error, reads.rows, retry],
  );
}
