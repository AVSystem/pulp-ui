import { z } from 'zod';

// One role held by a user or a group, cut to what the object-permission index
// needs: the role's name and the object it is held on (null, or absent, for a
// role held on every object of its kind). The permissions of the role are not
// asked for with an assignment: asking the server for them on every row costs
// several times the rest of the answer, so they come from one read of the
// roles. Only an account that may not read the roles asks for them with each
// assignment, and then they are present. A field this schema does not name is
// kept as it came.
//
// The generated response schema of the sdk is used for types only.
const roleAssignmentSchema = z.looseObject({
  role: z.string(),
  content_object: z.string().nullish(),
  permissions: z.array(z.string()).nullish(),
});

const roleAssignmentPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(roleAssignmentSchema),
});

// A role as the catalogue of roles lists it, cut to its name and permissions.
const rolePermissionsSchema = z.looseObject({
  name: z.string(),
  permissions: z.array(z.string()).nullish(),
});

const rolePermissionsPageSchema = z.looseObject({
  count: z.number(),
  next: z.string().nullish(),
  previous: z.string().nullish(),
  results: z.array(rolePermissionsSchema),
});

type RoleAssignment = z.infer<typeof roleAssignmentSchema>;
type RoleAssignmentPage = z.infer<typeof roleAssignmentPageSchema>;
type RolePermissionsPage = z.infer<typeof rolePermissionsPageSchema>;

// Who holds roles: the signed-in user or one of their groups, by address.
interface RoleOwner {
  kind: 'user' | 'group';
  href: string;
}

// The roles held on each object, by the object's address.
type ObjectGrants = Map<string, Set<string>>;

// What each role allows, by the role's name.
type RolePermissions = ReadonlyMap<string, readonly string[]>;

// Records the assignments that name an object. A role held on every object of
// its kind names none and is left to the global permissions.
function addAssignments(
  grants: ObjectGrants,
  assignments: readonly Pick<RoleAssignment, 'role' | 'content_object'>[],
): void {
  for (const { role, content_object: object } of assignments) {
    if (!object) {
      continue;
    }
    const roles = grants.get(object);
    if (roles) {
      roles.add(role);
    } else {
      grants.set(object, new Set([role]));
    }
  }
}

// Records what each role allows as the assignments carry it, for an account
// that may not read the catalogue of roles. A role is the same whoever holds
// it, so the first assignment of a role says what it allows.
function addPermissions(
  permissions: Map<string, readonly string[]>,
  assignments: readonly Pick<RoleAssignment, 'role' | 'permissions'>[],
): void {
  for (const { role, permissions: allowed } of assignments) {
    if (allowed && !permissions.has(role)) {
      permissions.set(role, allowed);
    }
  }
}

// The question "may the user do this on that object": true when a role held on
// that object allows the permission. A role the catalogue does not know allows
// nothing. This is for showing or hiding an action only; the server decides
// every request.
function objectPermissionIndex(
  grants: ObjectGrants,
  permissionsOfRole: RolePermissions,
): (object: string | null | undefined, permission: string) => boolean {
  return (object, permission) => {
    const roles = object ? grants.get(object) : undefined;
    if (!roles) {
      return false;
    }
    return Array.from(roles).some((role) =>
      permissionsOfRole.get(role)?.includes(permission),
    );
  };
}

export {
  addAssignments,
  addPermissions,
  objectPermissionIndex,
  roleAssignmentPageSchema,
  roleAssignmentSchema,
  rolePermissionsPageSchema,
};
export type {
  ObjectGrants,
  RoleAssignment,
  RoleAssignmentPage,
  RoleOwner,
  RolePermissions,
  RolePermissionsPage,
};
