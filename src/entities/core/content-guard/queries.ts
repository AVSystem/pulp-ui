import { useSessionQuery } from 'src/query/use-session-query';
import { isSessionEnd } from 'src/utilities/request-error';
import { ContentGuardClient } from './client';

export const contentGuardKeys = {
  all: ['pulp', 'core', 'content-guard'] as const,
  // The names of the guards at some addresses, read together.
  names: (hrefs: readonly string[]) =>
    [...contentGuardKeys.all, 'names', hrefs] as const,
};

// The names of the content guards at these addresses, by address. A guard the
// user may not see has no name: a refused or failed read leaves the names out
// and the caller shows the guard without one. The end of the session is not
// that, and is left to the sign-in dialog, which has the read start again.
// Nothing is asked for no addresses.
export function useContentGuardNames(hrefs: readonly string[]): {
  names: ReadonlyMap<string, string>;
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

  return { names: read.data ?? new Map() };
}
