import { userUrlId } from 'src/entities/core/user/href';
import { config } from 'src/ui-config';

// A group is addressed in the browser by its numeric id and held inside the
// app by its pulp_href. These two functions are the only place that turns the
// one into the other: a screen that built a group path by hand could send a
// request to something that is not a group.
const ID_ONLY = /^[1-9][0-9]*$/;
const GROUP_HREF = /(?:^|\/)groups\/([1-9][0-9]*)\/?$/;

// The address of the group with this id, or null when the text is not a
// positive whole number. Whatever a visitor typed into the address bar reaches
// a request only through here.
export function groupHref(urlId: string | null | undefined): string | null {
  return typeof urlId === 'string' && ID_ONLY.test(urlId)
    ? `${config.API_BASE_PATH}groups/${urlId}/`
    : null;
}

// The id of the group a pulp_href names, or null when it names anything else
// (a user, or a part of a group such as its members).
export function groupUrlId(href: string | null | undefined): string | null {
  if (typeof href !== 'string') {
    return null;
  }
  const path = href.split(/[?#]/)[0];
  return GROUP_HREF.exec(path)?.[1] ?? null;
}

// The address of one member of a group, the endpoint that takes the user out of
// the group. It is built from the address of the group and the address of the
// user (the member's pulp_href), and is null unless the first names a group and
// the second a user: a screen never writes the path itself, and an address of
// anything else never reaches a request.
export function groupMemberHref(
  group: string | null | undefined,
  user: string | null | undefined,
): string | null {
  const groupId = groupUrlId(group);
  const userId = userUrlId(user);

  return groupId === null || userId === null
    ? null
    : `${config.API_BASE_PATH}groups/${groupId}/users/${userId}/`;
}
