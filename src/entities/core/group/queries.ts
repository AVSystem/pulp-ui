import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { GroupClient } from './client';
import { type GroupListParams, type NewGroup } from './model';

const all = ['pulp', 'core', 'group'] as const;

export const groupKeys = {
  all,
  list: (params: GroupListParams) => [...all, 'list', params] as const,
  members: (href: string, limit: number) =>
    [...all, 'members', href, limit] as const,
};

// How a read of groups behaves beyond its parameters.
export interface GroupReadOptions {
  // False keeps the read off, for a screen that does not draw the groups it
  // would read: nothing is asked of the server that nobody sees.
  enabled?: boolean;
  // Which rows stay on screen while another read loads. 'any-search' keeps
  // the rows of whatever was read before, for a search box that offers
  // choices as the text changes; 'other-page' keeps them only when the read
  // before was another page of the same list, so rows are never shown for a
  // filter, order or page size they were not read for.
  keep?: 'any-search' | 'other-page';
}

// Whether two reads ask for the same page of the same filter. The same read is
// not a stand-in for itself: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function sameRead(a: GroupListParams, b: GroupListParams): boolean {
  return (
    a.page === b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.name__contains === b.name__contains &&
    a.name__icontains === b.name__icontains
  );
}

// Whether two reads differ in the page only.
function otherPageOfSameList(a: GroupListParams, b: GroupListParams): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.name__contains === b.name__contains &&
    a.name__icontains === b.name__icontains
  );
}

// One page of groups. Every set of parameters is a query of its own, so the
// answer to an earlier search never lands in the place of a later one.
export function useGroups(
  params: GroupListParams,
  { enabled = true, keep = 'any-search' }: GroupReadOptions = {},
) {
  return useSessionQuery({
    queryKey: groupKeys.list(params),
    queryFn: ({ signal }) => GroupClient.list(params, { signal }),
    enabled,
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as GroupListParams | undefined;
      if (!before) {
        return undefined;
      }
      const keepRows =
        keep === 'other-page'
          ? otherPageOfSameList(before, params)
          : !sameRead(before, params);
      return keepRows ? previous : undefined;
    },
  });
}

// The first members of a group, with how many there are in all. A null address
// is the address of nothing: no request is sent. The answer is forgotten as
// soon as nothing shows it, so a dialog opened again never starts from a
// member count that has since changed.
export function useGroupMembers(
  href: string | null,
  { limit = 10, enabled = true }: { limit?: number; enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: groupKeys.members(href ?? '', limit),
    queryFn: ({ signal }) =>
      GroupClient.members(href as string, { limit }, { signal }),
    enabled: enabled && href !== null,
    gcTime: 0,
  });
}

// Creates a group. One request is sent per call and it is never repeated by
// itself; once it has succeeded the lists are read again.
export function useCreateGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (group: NewGroup) => GroupClient.create(group),
    onSuccess: () => {
      // the screen moves on at once; the lists catch up in the background
      void queryClient.invalidateQueries({ queryKey: groupKeys.all });
    },
  });
}

export interface DeleteGroupRequest {
  // The address of the group to delete.
  href: string;
}

// Deletes a group. One request is sent per call and it is never repeated by
// itself. The call settles after the lists have been read again, so a screen
// that closes its dialog then shows rows without the group.
export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href }: DeleteGroupRequest) => GroupClient.remove(href),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: groupKeys.all }),
  });
}
