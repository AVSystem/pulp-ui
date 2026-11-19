import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { RoleClient } from './client';
import type { NewRole, RoleChanges, RoleListParams } from './model';

const all = ['pulp', 'core', 'role'] as const;

export const roleKeys = {
  all,
  list: (params: RoleListParams) => [...all, 'list', params] as const,
  detail: (href: string) => [...all, 'detail', href] as const,
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
    a.object_type === b.object_type &&
    a.locked === b.locked
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

// One role by its address. A null address is the address of nothing: no request
// is sent.
export function useRole(href: string | null) {
  return useSessionQuery({
    queryKey: roleKeys.detail(href ?? ''),
    queryFn: ({ signal }) => RoleClient.retrieve(href as string, { signal }),
    enabled: href !== null,
  });
}

// Creates a role. One request is sent per call and it is never repeated by
// itself; once it has succeeded the lists are read again.
export function useCreateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (role: NewRole) => RoleClient.create(role),
    onSuccess: () => {
      // the screen moves on at once; the lists catch up in the background
      void queryClient.invalidateQueries({ queryKey: roleKeys.all });
    },
  });
}

export interface UpdateRoleRequest {
  // The address of the role to change.
  href: string;
  // The fields to change; the others stay as they are.
  changes: RoleChanges;
}

// Changes a role (its permissions, and with them the description). One request
// is sent per call and it is never repeated by itself. Once it has succeeded
// the role is what the server answered, so a screen that shows it never goes
// back to the values from before the save, and the role and the lists are read
// again.
export function useUpdateRolePermissions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href, changes }: UpdateRoleRequest) =>
      RoleClient.updatePermissions(href, changes),
    onSuccess: (updated, { href }) => {
      queryClient.setQueryData(roleKeys.detail(href), updated);
      // the screen moves on at once; the lists catch up in the background
      void queryClient.invalidateQueries({ queryKey: roleKeys.all });
    },
  });
}

export interface DeleteRoleRequest {
  // The address of the role to delete.
  href: string;
}

// Deletes a role. One request is sent per call and it is never repeated by
// itself. The call settles after the lists have been read again, so a screen
// that closes its dialog then shows rows without the role. What was read of the
// role itself is forgotten and not read again: the answer could only be a
// failure, and the role must not come back from the cache.
export function useDeleteRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href }: DeleteRoleRequest) => RoleClient.remove(href),
    onSuccess: async (_data, { href }) => {
      queryClient.removeQueries({ queryKey: roleKeys.detail(href) });
      await queryClient.invalidateQueries({ queryKey: roleKeys.all });
    },
  });
}
