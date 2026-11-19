import { config } from 'src/ui-config';

// A role is addressed in the browser by its id (a uuid) and held inside the
// app by its pulp_href. These two functions are the only place that turns the
// one into the other: a screen that built a role path by hand could send a
// request to something that is not a role.
const ID_ONLY =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_HREF =
  /(?:^|\/)roles\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

// The address of the role with this id, or null when the text is not the id of
// a role. Whatever a visitor typed into the address bar reaches a request only
// through here.
export function roleHref(urlId: string | null | undefined): string | null {
  return typeof urlId === 'string' && ID_ONLY.test(urlId)
    ? `${config.API_BASE_PATH}roles/${urlId}/`
    : null;
}

// The id of the role a pulp_href names, or null when it names anything else (a
// user, or a part of a role such as its permissions).
export function roleUrlId(href: string | null | undefined): string | null {
  if (typeof href !== 'string') {
    return null;
  }
  const path = href.split(/[?#]/)[0];
  return ROLE_HREF.exec(path)?.[1] ?? null;
}
