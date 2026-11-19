import {
  groupsCreate,
  groupsDelete,
  groupsList,
  groupsRead,
} from '@pulp-ui/sdk/core/groups';
import {
  groupsUsersCreate,
  groupsUsersDelete,
  groupsUsersList,
} from '@pulp-ui/sdk/core/groups-users';
import type { GroupsListParams } from '@pulp-ui/sdk/core/models/groups/groups-list-params.zod';
import { parseResponse } from 'src/entities/response-shape';
import { groupMemberHref } from './href';
import {
  DEFAULT_PAGE_SIZE,
  type Group,
  type GroupListParams,
  type GroupMember,
  type GroupMemberPage,
  type GroupPage,
  type NewGroup,
  groupMemberPageSchema,
  groupPageSchema,
  groupSchema,
} from './model';

// Turns the page, size and sort of the screen into what the server takes: an
// offset, a limit and an ordering. A filter that is not set is not sent.
function toRequestParams(params: GroupListParams): GroupsListParams {
  const limit = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const request: GroupsListParams = { offset: (page - 1) * limit, limit };

  if (params.sort) {
    // The server rejects an ordering it does not know; that answer is shown
    // as a failed read.
    request.ordering = [params.sort] as GroupsListParams['ordering'];
  }
  if (params.name__contains) {
    request.name__contains = params.name__contains;
  }
  if (params.name__icontains) {
    request.name__icontains = params.name__icontains;
  }

  return request;
}

// Lists one page of groups. The options reach `fetch`, so an abort signal
// cancels the request. An answer that does not match the model is a
// ResponseShapeError.
async function list(
  params: GroupListParams,
  options?: RequestInit,
): Promise<GroupPage> {
  const data = await groupsList(toRequestParams(params), options);
  return parseResponse(groupPageSchema, data);
}

// Reads one group by its address.
async function retrieve(href: string, options?: RequestInit): Promise<Group> {
  const data = await groupsRead(href, undefined, options);
  return parseResponse(groupSchema, data);
}

// Creates a group.
async function create(group: NewGroup, options?: RequestInit): Promise<Group> {
  const data = await groupsCreate(group, options);
  return parseResponse(groupSchema, data);
}

// Deletes a group with one request. The server answers with no content.
async function remove(href: string, options?: RequestInit): Promise<void> {
  await groupsDelete(href, options);
}

// Reads one page of the members of a group from the group's own endpoint. The
// list of all users cannot stand in for it: the server does not filter users
// by group.
async function members(
  href: string,
  { limit = 10, offset = 0 }: { limit?: number; offset?: number } = {},
  options?: RequestInit,
): Promise<GroupMemberPage> {
  const data = await groupsUsersList(href, { limit, offset }, options);
  return parseResponse(groupMemberPageSchema, data);
}

// How many members one request of allMembers asks for.
const MEMBERS_CHUNK = 1000;

// Reads every member of a group, page after page from the group's own
// endpoint, until the server says there is no next page or a page comes back
// empty (a list that shrank while it was read never loops). Each page starts
// where the received members end; a member that shows on two pages because the
// list changed in between is kept once.
async function allMembers(
  href: string,
  options?: RequestInit,
): Promise<GroupMember[]> {
  const byName = new Map<string, GroupMember>();
  let received = 0;

  for (;;) {
    const page = await members(
      href,
      { limit: MEMBERS_CHUNK, offset: received },
      options,
    );
    for (const member of page.results) {
      byName.set(member.username, member);
    }
    received += page.results.length;
    if (!page.next || page.results.length === 0) {
      return Array.from(byName.values());
    }
  }
}

// Adds one user to a group, by username, with one request.
async function addMember(
  href: string,
  username: string,
  options?: RequestInit,
): Promise<void> {
  await groupsUsersCreate(href, { username }, options);
}

// Takes one member out of a group with one request. The endpoint is built from
// the address of the group and the member's own address; a member without the
// address of a user has none, and no request is sent.
async function removeMember(
  groupHref: string,
  memberHref: string | null | undefined,
  options?: RequestInit,
): Promise<void> {
  const target = groupMemberHref(groupHref, memberHref);
  if (target === null) {
    throw new Error('The member has no address to be removed by.');
  }
  await groupsUsersDelete(target, options);
}

export const GroupClient = {
  list,
  retrieve,
  create,
  remove,
  members,
  allMembers,
  addMember,
  removeMember,
};
