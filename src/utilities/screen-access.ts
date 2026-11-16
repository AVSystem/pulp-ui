import type { IPermissionsContextType } from 'src/permissions';

// The administration screens whose menu entry and route depend on who is
// signed in.
export type AdminScreen = 'users' | 'groups' | 'roles' | 'signing-services';

// The permission that lets a user view each screen, as Pulp names it. A screen
// without a name is for staff only: Pulp reads the roles of a deployment only
// for a superuser, so no permission grants it to anybody else.
export const SCREEN_ACCESS: Record<AdminScreen, string | null> = {
  users: 'auth.view_user',
  groups: 'core.view_group',
  roles: null,
  'signing-services': 'core.view_signingservice',
};

// Whether the screen is offered to the signed-in user. This is presentation
// only: Pulp decides every request, and a screen offered here may still be
// answered with a refusal. While the permissions are unknown, after a failed
// read and while signed out nothing is offered, and a screen this module does
// not know is never offered.
export function canViewScreen(
  screen: string,
  permissions: IPermissionsContextType,
): boolean {
  if (
    permissions.state !== 'ready' ||
    !Object.prototype.hasOwnProperty.call(SCREEN_ACCESS, screen)
  ) {
    return false;
  }
  // The own record's staff flag stands in for the superuser flag, which the
  // sign-in answer does not expose. An account that is staff but not superuser
  // is offered screens Pulp then refuses; that is presentation only.
  if (permissions.isStaff) {
    return true;
  }
  const permission = SCREEN_ACCESS[screen as AdminScreen];
  return permission !== null && permissions.hasPermission(permission);
}
