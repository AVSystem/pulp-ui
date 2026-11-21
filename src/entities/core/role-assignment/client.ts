import { groupsRolesList } from '@pulp-ui/sdk/core/groups-roles';
import type { GroupsRolesListParams } from '@pulp-ui/sdk/core/models/groups-roles/groups-roles-list-params.zod';
import type { RolesListParams } from '@pulp-ui/sdk/core/models/roles/roles-list-params.zod';
import type { UsersRolesListParams } from '@pulp-ui/sdk/core/models/users-roles/users-roles-list-params.zod';
import { rolesList } from '@pulp-ui/sdk/core/roles';
import { usersRolesList } from '@pulp-ui/sdk/core/users-roles';
import { parseResponse } from 'src/entities/response-shape';
import {
  type RoleAssignmentPage,
  type RoleOwner,
  type RolePermissions,
  roleAssignmentPageSchema,
  rolePermissionsPageSchema,
} from './model';

// Rows per page. The server answers at most this many.
export const ASSIGNMENT_PAGE = 1000;

// What an assignment is asked for. The permissions of a role are left out on
// purpose: they are the costliest part of the answer and the same for every
// assignment of one role. An account that may not read the roles has no other
// way to learn them, and asks for them with each assignment.
const ASSIGNMENT_FIELDS = ['role', 'content_object'];
const ASSIGNMENT_FIELDS_WITH_PERMISSIONS = [
  ...ASSIGNMENT_FIELDS,
  'permissions',
];

// Reads one page of the roles an owner holds, on every object and on single
// objects alike (no `content_object` filter). The pages are ordered by key so
// that reading them one after the other, or two at a time, neither repeats nor
// skips a row. The options reach `fetch`, so an abort signal cancels the
// request. An answer that does not match the model is a ResponseShapeError.
async function page(
  owner: RoleOwner,
  offset: number,
  options?: RequestInit,
  withPermissions = false,
): Promise<RoleAssignmentPage> {
  const params: UsersRolesListParams & GroupsRolesListParams = {
    offset,
    limit: ASSIGNMENT_PAGE,
    ordering: ['pk'],
    fields: withPermissions
      ? ASSIGNMENT_FIELDS_WITH_PERMISSIONS
      : ASSIGNMENT_FIELDS,
  };
  const data =
    owner.kind === 'user'
      ? await usersRolesList(owner.href, params, options)
      : await groupsRolesList(owner.href, params, options);
  return parseResponse(roleAssignmentPageSchema, data);
}

// Reads the catalogue of roles with only the name and the permissions of each,
// every page, as one map from the role's name to what it allows.
async function rolePermissions(
  options?: RequestInit,
): Promise<RolePermissions> {
  const permissions = new Map<string, readonly string[]>();
  let offset = 0;

  for (;;) {
    const params: RolesListParams = {
      offset,
      limit: ASSIGNMENT_PAGE,
      fields: ['name', 'permissions'],
    };
    const read = parseResponse(
      rolePermissionsPageSchema,
      await rolesList(params, options),
    );
    for (const role of read.results) {
      permissions.set(role.name, role.permissions ?? []);
    }
    offset += read.results.length;
    if (read.results.length === 0 || offset >= read.count) {
      return permissions;
    }
  }
}

export const RoleAssignmentClient = { page, rolePermissions };
