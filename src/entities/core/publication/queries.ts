import { useCallback, useMemo } from 'react';
import { useChunkedRead } from '../chunked-read';
import { PublicationClient, type PublicationRef } from './client';

export const publicationRefKeys = {
  all: ['pulp', 'core', 'publication'] as const,
  // One group of publications at known addresses, read with one request.
  chunk: (hrefs: readonly string[]) =>
    [...publicationRefKeys.all, 'chunk', hrefs] as const,
};

export interface PublicationsByHref {
  status: 'pending' | 'error' | 'success';
  error: unknown;
  // The publications the user may read, by address; undefined until every
  // group is read. An address that is not in it names a publication that is
  // not readable.
  publications: ReadonlyMap<string, PublicationRef> | undefined;
  // Reads again the groups that failed.
  retry: () => void;
}

// The publications at these addresses, whatever their plugin: one read for each
// group of addresses the URL budget allows and never one for a publication.
export function usePublicationsByHref(
  hrefs: readonly string[],
): PublicationsByHref {
  const chunks = useMemo(() => PublicationClient.chunks(hrefs), [hrefs]);
  const keyOf = useCallback(
    (chunk: string[]) => publicationRefKeys.chunk(chunk),
    [],
  );
  const read = useCallback(
    (chunk: string[], options: { signal: AbortSignal }) =>
      PublicationClient.byHrefs(chunk, options),
    [],
  );
  const { status, error, rows, retry } = useChunkedRead({
    chunks,
    keyOf,
    read,
  });

  return { status, error, publications: rows, retry };
}
