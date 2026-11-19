import { groupUrlId } from 'src/entities/core/group/href';
import { config } from 'src/ui-config';

// The role of a group is addressed by its own pulp_href. The endpoint that takes
// the role away from the group is built here from the address of the group and
// the address of the role: it is null unless the first names a group, the second
// names a role of that same group and nothing else follows. A screen never
// writes the path itself, and an address of anything else never reaches a
// request.
const GROUP_ROLE_HREF =
  /(?:^|\/)groups\/([1-9][0-9]*)\/roles\/([A-Za-z0-9_-]+)\/?$/;

export function groupRoleHref(
  group: string | null | undefined,
  role: string | null | undefined,
): string | null {
  const groupId = groupUrlId(group);
  if (groupId === null || typeof role !== 'string') {
    return null;
  }
  const match = GROUP_ROLE_HREF.exec(role.split(/[?#]/)[0]);

  return match === null || match[1] !== groupId
    ? null
    : `${config.API_BASE_PATH}groups/${groupId}/roles/${match[2]}/`;
}
