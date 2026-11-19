import {
  groupsCreate,
  groupsDelete,
  groupsList,
  groupsRead,
} from '@pulp-ui/sdk/core/groups';
import { groupsUsersList } from '@pulp-ui/sdk/core/groups-users';
import type { GroupsListParams } from '@pulp-ui/sdk/core/models/groups/groups-list-params.zod';
import { parseResponse } from 'src/entities/response-shape';
import {
  DEFAULT_PAGE_SIZE,
  type Group,
  type GroupListParams,
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
  { limit = 10 }: { limit?: number } = {},
  options?: RequestInit,
): Promise<GroupMemberPage> {
  const data = await groupsUsersList(href, { limit, offset: 0 }, options);
  return parseResponse(groupMemberPageSchema, data);
}

export const GroupClient = { list, retrieve, create, remove, members };
