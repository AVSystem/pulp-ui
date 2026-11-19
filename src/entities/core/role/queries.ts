import { useSessionQuery } from 'src/query/use-session-query';
import { RoleClient } from './client';
import type { RoleListParams } from './model';

const all = ['pulp', 'core', 'role'] as const;

export const roleKeys = {
  all,
  list: (params: RoleListParams) => [...all, 'list', params] as const,
};

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function otherPageOfSameList(a: RoleListParams, b: RoleListParams): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.name__icontains === b.name__icontains &&
    a.object_type === b.object_type
  );
}

// One page of roles. Every set of parameters is a query of its own, so an older
// answer never lands in the place of a newer one. While another page of the
// same list loads the rows of the page before stay; rows read for another
// filter or order are never shown in their place.
export function useRoles(params: RoleListParams) {
  return useSessionQuery({
    queryKey: roleKeys.list(params),
    queryFn: ({ signal }) => RoleClient.list(params, { signal }),
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as RoleListParams | undefined;
      return before && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}
