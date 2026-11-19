import { useSessionQuery } from 'src/query/use-session-query';
import { UserClient } from './client';
import { type UserListParams } from './model';

const all = ['pulp', 'core', 'user'] as const;

export const userKeys = {
  all,
  list: (params: UserListParams) => [...all, 'list', params] as const,
  detail: (href: string) => [...all, 'detail', href] as const,
};

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function otherPageOfSameList(a: UserListParams, b: UserListParams): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.username__contains === b.username__contains &&
    a.first_name__contains === b.first_name__contains &&
    a.last_name__contains === b.last_name__contains &&
    a.email__contains === b.email__contains
  );
}

// One page of users. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads, the rows of the page before stay; rows that were read
// for other filters or another order are never shown in their place.
export function useUsers(params: UserListParams) {
  return useSessionQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) => UserClient.list(params, { signal }),
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as UserListParams | undefined;
      return before && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// One user by its address. A null address is the address of nothing: no
// request is sent.
export function useUser(href: string | null) {
  return useSessionQuery({
    queryKey: userKeys.detail(href ?? ''),
    queryFn: ({ signal }) => UserClient.retrieve(href as string, { signal }),
    enabled: href !== null,
  });
}
