import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback } from 'react';
import { useSessionQuery } from 'src/query/use-session-query';
import { GroupClient } from './client';
import {
  type GroupListParams,
  type GroupMemberListParams,
  type NewGroup,
  pageOfMembers,
} from './model';

const all = ['pulp', 'core', 'group'] as const;

export const groupKeys = {
  all,
  list: (params: GroupListParams) => [...all, 'list', params] as const,
  detail: (href: string) => [...all, 'detail', href] as const,
  // Everything read of the members of one group, whatever the read.
  membersOf: (href: string) => [...all, 'members', href] as const,
  // The first members of a group and how many there are.
  members: (href: string, limit: number) =>
    [...all, 'members', href, limit] as const,
  // Every member of a group, for the tab that lists them.
  allMembers: (href: string) => [...all, 'members', href, 'all'] as const,
  // The usernames of every member, for the dialog that adds members.
  memberNames: (href: string) => [...all, 'members', href, 'names'] as const,
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

// One group by its address. A null address is the address of nothing: no
// request is sent.
export function useGroup(
  href: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: groupKeys.detail(href ?? ''),
    queryFn: ({ signal }) => GroupClient.retrieve(href as string, { signal }),
    enabled: enabled && href !== null,
  });
}

// The members of a group as a page of the screen: the filter, the order, the
// page and its size are cut from every member of the group, because the server
// lists the members but does not filter or sort them. Every set of parameters
// shares the one read of the members, so a newer filter never waits for an
// older answer and no filter sends a request.
export function useGroupMemberList(
  href: string | null,
  params: GroupMemberListParams,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const { page, page_size, sort, username } = params;
  const select = useCallback(
    (members: Awaited<ReturnType<typeof GroupClient.allMembers>>) =>
      pageOfMembers(members, { page, page_size, sort, username }),
    [page, page_size, sort, username],
  );

  return useSessionQuery({
    queryKey: groupKeys.allMembers(href ?? ''),
    queryFn: ({ signal }) => GroupClient.allMembers(href as string, { signal }),
    enabled: enabled && href !== null,
    select,
  });
}

// The usernames of every member of a group, for judging who can still be added.
// Every page is read, and the answer is read afresh each time something asks
// for it and forgotten as soon as nothing shows it: a member added by someone
// else a moment ago is never offered again.
export function useAllGroupMemberNames(
  href: string | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useSessionQuery({
    queryKey: groupKeys.memberNames(href ?? ''),
    queryFn: async ({ signal }) =>
      (await GroupClient.allMembers(href as string, { signal })).map(
        (member) => member.username,
      ),
    enabled: enabled && href !== null,
    staleTime: 0,
    gcTime: 0,
  });
}

// Reads the members of a group again wherever they are shown. The usernames
// the add dialog judges by are left alone: nothing needs them while the
// request that changes the members is under way, and the dialog reads them
// afresh when it opens.
function refreshMembers(queryClient: QueryClient, href: string) {
  return queryClient.invalidateQueries({
    queryKey: groupKeys.membersOf(href),
    predicate: (query) => query.queryKey[5] !== 'names',
  });
}

export interface AddGroupMembersRequest {
  // The address of the group.
  href: string;
  // The users to add, by username.
  usernames: string[];
}

// What became of the request to add one user: the failure, or null when the
// user is a member now.
export interface AddGroupMemberOutcome {
  username: string;
  error: unknown | null;
}

// Adds users to a group with one request for each. The call never fails as a
// whole: it settles once every request has, with the outcome of each, so a
// screen can say what happened to each user. Nothing is repeated by itself.
// The members are read again before the call settles, so what the screen shows
// next is what the server holds.
export function useAddGroupMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      href,
      usernames,
    }: AddGroupMembersRequest): Promise<AddGroupMemberOutcome[]> =>
      Promise.all(
        usernames.map((username) =>
          GroupClient.addMember(href, username).then(
            () => ({ username, error: null }),
            (error: unknown) => ({ username, error }),
          ),
        ),
      ),
    onSettled: (_outcomes, _error, { href }) =>
      refreshMembers(queryClient, href),
  });
}

export interface RemoveGroupMemberRequest {
  // The address of the group.
  href: string;
  // The member's own address (its pulp_href), which names the user to take out.
  member: string | null | undefined;
}

// Takes one member out of a group. One request is sent per call and it is never
// repeated by itself; once it has succeeded the members are read again before
// the call settles.
export function useRemoveGroupMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href, member }: RemoveGroupMemberRequest) =>
      GroupClient.removeMember(href, member),
    onSuccess: (_data, { href }) => refreshMembers(queryClient, href),
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

// Whether a cached read is a read of this one group (the group itself or its
// members), as opposed to a list of groups.
function readsOneGroup(queryKey: readonly unknown[], href: string): boolean {
  return (
    (queryKey[3] === 'detail' || queryKey[3] === 'members') &&
    queryKey[4] === href
  );
}

// Deletes a group. One request is sent per call and it is never repeated by
// itself. The call settles after the lists have been read again, so a screen
// that closes its dialog then shows rows without the group. What was read of
// the group itself is forgotten and not read again: the answer could only be a
// failure, and the group must not come back from the cache. The screen that
// asked leaves or closes what shows the group as soon as the call settles.
export function useDeleteGroup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ href }: DeleteGroupRequest) => GroupClient.remove(href),
    onSuccess: async (_data, { href }) => {
      await queryClient.invalidateQueries({
        queryKey: groupKeys.all,
        predicate: (query) => !readsOneGroup(query.queryKey, href),
      });
      queryClient.removeQueries({
        predicate: (query) => readsOneGroup(query.queryKey, href),
      });
    },
  });
}
