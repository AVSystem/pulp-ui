import { GroupRoleAPI } from '../api/group-role';
import { UserAPI } from '../api/user';
import { UserRoleAPI } from '../api/user-role';
import { type ISessionUser } from '../user-context';
import { listAll } from './list-all';

// What a signed-in user may do on every object of a kind, as far as the
// server's own answers say: the staff flag of their record, or the union of the
// permissions of the roles they hold themselves and through their groups.
export interface IGlobalPermissions {
  isStaff: boolean;
  global: ReadonlySet<string>;
}

interface IRoleEntry {
  permissions?: string[];
}

// The key of an object address: the last path segment, which is a number for
// users and groups.
export function idFromHref(href?: string | null): string | null {
  const segments = String(href ?? '')
    .split('/')
    .filter(Boolean);
  return segments.length ? segments[segments.length - 1] : null;
}

// Reads the permissions the user holds without any object. Only standard
// endpoints are used: the user's own record, their own roles and the roles of
// each group listed in that record. A role granted on one object is not read
// here; that is what an object's my_permissions list answers. Any failed read
// rejects, so a partial answer is never mistaken for the whole one. What is
// shown from this is presentation only: the server decides every request.
export async function loadGlobalPermissions(
  user: ISessionUser,
): Promise<IGlobalPermissions> {
  const userId = idFromHref(user.pulp_href);
  if (!userId) {
    throw new Error('The signed-in user has no address to read roles from.');
  }

  const { data: record } = await UserAPI.get(userId);
  if (record?.is_staff) {
    return { isStaff: true, global: new Set() };
  }

  const groupIds: string[] = (record?.groups ?? [])
    .map((group) => (group?.id ?? idFromHref(group?.pulp_href))?.toString())
    .filter(Boolean);

  // A role entry with content_object null is a role held on every object.
  const withoutObject = { content_object: 'null' };
  const lists = await Promise.all([
    listAll<IRoleEntry>(
      (params) => UserRoleAPI.listRoles(userId, params),
      withoutObject,
    ),
    ...groupIds.map((groupId) =>
      listAll<IRoleEntry>(
        (params) => GroupRoleAPI.listRoles(groupId, params),
        withoutObject,
      ),
    ),
  ]);

  const global = new Set<string>();
  for (const entries of lists) {
    for (const entry of entries) {
      for (const permission of entry.permissions ?? []) {
        global.add(permission);
      }
    }
  }
  return { isStaff: false, global };
}
