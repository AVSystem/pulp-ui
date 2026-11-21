import { apiPathOfHref } from 'src/entities/href';

// Sends the request of a member that acts on one object, given the object's
// address (pulp_href). The request goes to the path of that address below the
// API base, so what the server named is what is requested: no id is cut out of
// the address and put into a path built by hand.
//
// `collection` is the path of the object's kind below the API base, with its
// trailing slash ("repositories/file/file/"). An address that is not of the
// API, names another kind, or goes deeper than one object (a version, an action
// of the object, a query) is refused with a rejected promise before anything is
// sent, so a tampered address can neither reach another endpoint nor leave the
// API. `send` receives the object's path with its trailing slash.
export function atHref(
  href: string | null | undefined,
  collection: string,
  send: (path: string) => Promise<{ data }>,
): Promise<{ data }> {
  const path = apiPathOfHref(href);
  const rest = path?.startsWith(collection)
    ? path.slice(collection.length)
    : null;

  if (rest === null || !/^[^/]+\/?$/.test(rest)) {
    return Promise.reject(
      new Error(`The address does not name an object under ${collection}`),
    );
  }

  return send(path.endsWith('/') ? path : `${path}/`);
}
