import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { GroupRoleClient } from './client';
import type { GroupRoleListParams } from './model';

const all = ['pulp', 'core', 'group-role'] as const;

export const groupRoleKeys = {
  all,
  // Everything read of the roles of one group, whatever the page.
  of: (groupHref: string) => [...all, 'list', groupHref] as const,
  list: (groupHref: string, params: GroupRoleListParams) =>
    [...all, 'list', groupHref, params] as const,
};

// Whether two reads differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function otherPageOfSameList(
  a: GroupRoleListParams,
  b: GroupRoleListParams,
): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.role__icontains === b.role__icontains
  );
}

// One page of the roles of a group. A null address is the address of nothing:
// no request is sent. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads the rows of the page before stay; rows read for another
// filter or order are never shown in their place.
export function useGroupRoles(
  groupHref: string | null,
  params: GroupRoleListParams,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: groupRoleKeys.list(groupHref ?? '', params),
    queryFn: ({ signal }) =>
      GroupRoleClient.list(groupHref as string, params, { signal }),
    enabled: enabled && groupHref !== null,
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[5] as
        GroupRoleListParams | undefined;
      return before &&
        previousQuery?.queryKey[4] === groupHref &&
        otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// Reads the roles of a group again wherever they are shown.
function refreshRoles(queryClient: QueryClient, groupHref: string) {
  return queryClient.invalidateQueries({
    queryKey: groupRoleKeys.of(groupHref),
  });
}

export interface AddGroupRolesRequest {
  // The address of the group.
  href: string;
  // The roles to give, by name.
  roles: string[];
}

// What became of the request to give one role: the failure, or null when the
// group holds the role now.
export interface AddGroupRoleOutcome {
  role: string;
  error: unknown | null;
}

// Gives roles to a group with one request for each. The call never fails as a
// whole: it settles once every request has, with the outcome of each, so a
// screen can say what happened to each role. Nothing is repeated by itself. The
// roles are read again once, before the call settles.
export function useAddGroupRoles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      href,
      roles,
    }: AddGroupRolesRequest): Promise<AddGroupRoleOutcome[]> =>
      Promise.all(
        roles.map((role) =>
          GroupRoleClient.add(href, role).then(
            () => ({ role, error: null }),
            (error: unknown) => ({ role, error }),
          ),
        ),
      ),
    onSettled: (_outcomes, _error, { href }) => refreshRoles(queryClient, href),
  });
}

export interface RemoveGroupRoleRequest {
  // The address of the group.
  href: string;
  // The role's own address (its pulp_href), which names what to take away.
  role: string | null | undefined;
}

// Takes one role away from a group. One request is sent per call and it is never
// repeated by itself; once it has succeeded the roles are read again before the
// call settles.
export function useRemoveGroupRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href, role }: RemoveGroupRoleRequest) =>
      GroupRoleClient.remove(href, role),
    onSuccess: (_data, { href }) => refreshRoles(queryClient, href),
  });
}
