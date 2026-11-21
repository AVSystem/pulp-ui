import { groupHref } from 'src/entities/core/group/href';
import { GroupRoleAPI } from '../api/group-role';
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

// What the permission read needs of the signed-in user's own record.
export interface IOwnRecord {
  is_staff?: boolean | null;
  groups?: { id?: number | null; pulp_href?: string | null }[] | null;
}

// Reads the permissions the user holds without any object. Only standard
// endpoints are used: the user's own record (read by the caller, so that a
// screen showing the same record shares the read), their own roles and the
// roles of each group listed in that record. A role granted on one object is not read
// here; that is what an object's my_permissions list answers. Any failed read
// rejects, so a partial answer is never mistaken for the whole one. What is
// shown from this is presentation only: the server decides every request.
export async function loadGlobalPermissions(
  user: ISessionUser,
  readRecord: () => Promise<IOwnRecord>,
): Promise<IGlobalPermissions> {
  const userAddress = user.pulp_href;
  if (!userAddress) {
    throw new Error('The signed-in user has no address to read roles from.');
  }

  const record = await readRecord();
  // The staff flag of the own record stands in for the superuser flag, which
  // the sign-in answer does not expose. An account that is staff but not
  // superuser is offered actions Pulp refuses; that is presentation only.
  if (record?.is_staff) {
    return { isStaff: true, global: new Set() };
  }

  // The group's number names its address; the address the record carries is
  // the fallback for a record without one.
  const groupAddresses: string[] = (record?.groups ?? [])
    .map((group) =>
      group?.id != null ? groupHref(String(group.id)) : group?.pulp_href,
    )
    .filter(Boolean);

  // A role entry with content_object null is a role held on every object.
  const withoutObject = { content_object: 'null' };
  const lists = await Promise.all([
    listAll<IRoleEntry>(
      (params) => UserRoleAPI.listRoles(userAddress, params),
      withoutObject,
    ),
    ...groupAddresses.map((groupAddress) =>
      listAll<IRoleEntry>(
        (params) => GroupRoleAPI.listRoles(groupAddress, params),
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
