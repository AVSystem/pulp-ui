import { useSessionQuery } from 'src/query/use-session-query';
import { isSessionEnd } from 'src/utilities/request-error';
import { ContentGuardClient, GUARD_SEARCH_LIMIT } from './client';

export const contentGuardKeys = {
  all: ['pulp', 'core', 'content-guard'] as const,
  // The names of the guards at some addresses, read together.
  names: (hrefs: readonly string[]) =>
    [...contentGuardKeys.all, 'names', hrefs] as const,
  // The guards found by a search for a text; every text is a read of its own.
  search: (text: string) => [...contentGuardKeys.all, 'search', text] as const,
};

// The guards whose name holds the text, one page of 20 and the number that
// match in all. A failure is the query's error and is never turned into an
// empty list: the field shows it, with a way to read again. Every text has its
// own read, so the answer to an earlier text is never the list of a later one.
export function useContentGuardSearch(text: string) {
  return useSessionQuery({
    queryKey: contentGuardKeys.search(text),
    queryFn: ({ signal }) =>
      ContentGuardClient.search(text, GUARD_SEARCH_LIMIT, { signal }),
    staleTime: 30_000,
    retry: false,
  });
}

// The names of the content guards at these addresses, by address. A guard the
// user may not see has no name: a refused or failed read leaves the names out
// and the caller shows the guard without one. The end of the session is not
// that, and is left to the sign-in dialog, which has the read start again.
// Nothing is asked for no addresses. `pending` is true until the read has
// answered, so a guard that is still being read is not shown as one without a
// name.
export function useContentGuardNames(hrefs: readonly string[]): {
  names: ReadonlyMap<string, string>;
  pending: boolean;
} {
  const sorted = Array.from(new Set(hrefs)).sort();
  const read = useSessionQuery({
    queryKey: contentGuardKeys.names(sorted),
    queryFn: async ({ signal }) => {
      try {
        const groups = await Promise.all(
          ContentGuardClient.chunks(sorted).map((group) =>
            ContentGuardClient.names(group, { signal }),
          ),
        );
        return new Map(groups.flatMap((group) => Array.from(group)));
      } catch (error) {
        if (isSessionEnd(error)) {
          throw error;
        }
        return new Map<string, string>();
      }
    },
    enabled: sorted.length > 0,
    staleTime: 60_000,
    retry: false,
  });

  return {
    names: read.data ?? new Map(),
    pending: sorted.length > 0 && read.status === 'pending',
  };
}
