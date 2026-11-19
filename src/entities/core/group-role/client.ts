import {
  groupsRolesCreate,
  groupsRolesDelete,
  groupsRolesList,
} from '@pulp-ui/sdk/core/groups-roles';
import type { GroupsRolesListParams } from '@pulp-ui/sdk/core/models/groups-roles/groups-roles-list-params.zod';
import { parseResponse } from 'src/entities/response-shape';
import { groupRoleHref } from './href';
import {
  DEFAULT_PAGE_SIZE,
  type GroupRoleListParams,
  type GroupRolePage,
  groupRolePageSchema,
} from './model';

// Turns the page, size and sort of the screen into what the server takes: an
// offset, a limit and an ordering. A filter that is not set is not sent. Only
// the roles that act on the whole model are asked for: a role bound to one
// object is not what the roles tab of a group manages.
function toRequestParams(params: GroupRoleListParams): GroupsRolesListParams {
  const limit = Math.max(1, Math.trunc(params.page_size ?? DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const request: GroupsRolesListParams = {
    offset: (page - 1) * limit,
    limit,
    content_object: 'null',
  };

  if (params.sort) {
    // The server rejects an ordering it does not know; that answer is shown
    // as a failed read.
    request.ordering = [params.sort] as GroupsRolesListParams['ordering'];
  }
  if (params.role__icontains) {
    request.role__icontains = params.role__icontains;
  }

  return request;
}

// Lists one page of the roles of a group, by the address of the group. The
// options reach `fetch`, so an abort signal cancels the request. An answer that
// does not match the model is a ResponseShapeError.
async function list(
  groupHref: string,
  params: GroupRoleListParams,
  options?: RequestInit,
): Promise<GroupRolePage> {
  const data = await groupsRolesList(
    groupHref,
    toRequestParams(params),
    options,
  );
  return parseResponse(groupRolePageSchema, data);
}

// Gives one role to a group, by its name, with one request. The role acts on
// the whole model.
async function add(
  groupHref: string,
  role: string,
  options?: RequestInit,
): Promise<void> {
  await groupsRolesCreate(groupHref, { role, content_object: null }, options);
}

// Takes one role away from a group with one request. The endpoint is built from
// the address of the group and the address of the role; a role of another
// group, or an address of anything else, has none, and no request is sent.
async function remove(
  groupHref: string,
  roleHref: string | null | undefined,
  options?: RequestInit,
): Promise<void> {
  const target = groupRoleHref(groupHref, roleHref);
  if (target === null) {
    throw new Error('The role has no address of a role of this group.');
  }
  await groupsRolesDelete(target, options);
}

export const GroupRoleClient = { list, add, remove };
