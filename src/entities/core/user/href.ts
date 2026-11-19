import { config } from 'src/ui-config';

// A user is addressed in the browser by its numeric id and held inside the app
// by its pulp_href. These two functions are the only place that turns the one
// into the other: a screen that built a user path by hand could send a request
// to something that is not a user.
const ID_ONLY = /^[1-9][0-9]*$/;
const USER_HREF = /(?:^|\/)users\/([1-9][0-9]*)\/?$/;

// The address of the user with this id, or null when the text is not a
// positive whole number. Whatever a visitor typed into the address bar reaches
// a request only through here.
export function userHref(urlId: string | null | undefined): string | null {
  return typeof urlId === 'string' && ID_ONLY.test(urlId)
    ? `${config.API_BASE_PATH}users/${urlId}/`
    : null;
}

// The id of the user a pulp_href names, or null when it names anything else.
export function userUrlId(href: string | null | undefined): string | null {
  if (typeof href !== 'string') {
    return null;
  }
  const path = href.split(/[?#]/)[0];
  return USER_HREF.exec(path)?.[1] ?? null;
}
