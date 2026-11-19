import { useSessionQuery } from 'src/query/use-session-query';
import { GroupClient } from './client';
import { type GroupListParams } from './model';

const all = ['pulp', 'core', 'group'] as const;

export const groupKeys = {
  all,
  list: (params: GroupListParams) => [...all, 'list', params] as const,
};

// How a read of groups behaves beyond its parameters.
export interface GroupReadOptions {
  // False keeps the read off, for a screen that does not draw the groups it
  // would read: nothing is asked of the server that nobody sees.
  enabled?: boolean;
}

// Whether two reads ask for the same page of the same filter. The same read is
// not a stand-in for itself: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function sameRead(a: GroupListParams, b: GroupListParams): boolean {
  return (
    a.page === b.page &&
    a.page_size === b.page_size &&
    a.name__contains === b.name__contains
  );
}

// One page of groups. Every set of parameters is a query of its own, so the
// answer to an earlier search never lands in the place of a later one. While
// another search loads, the rows of the search before stay.
export function useGroups(
  params: GroupListParams,
  { enabled = true }: GroupReadOptions = {},
) {
  return useSessionQuery({
    queryKey: groupKeys.list(params),
    queryFn: ({ signal }) => GroupClient.list(params, { signal }),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as GroupListParams | undefined;
      return before && !sameRead(before, params) ? previous : undefined;
    },
  });
}
