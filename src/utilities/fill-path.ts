// Fills the :parameters of a route pattern with the values of an object, each
// encoded into exactly one path segment, so a value that came from the address
// bar or from the server can never add, remove or change a segment. A pattern
// segment that ends in ? is optional and drops out without a value.
//
// This module holds no import: the end-to-end runner reads the addresses of the
// screens through it and must not load the rest of the application. `formatPath`
// of src/paths.ts is this function plus a query string.

export interface FillPathOptions {
  // Keep a :parameter that has no value as it is, instead of failing. A menu
  // that matches an address against a pattern needs the pattern back.
  ignoreMissing?: boolean;
}

export function fillPath(
  path: string,
  data: Record<string, unknown> = {},
  options?: FillPathOptions,
): string {
  return (path + '/')
    .replaceAll('//', '/')
    .split('/')
    .map((fragment) => {
      const match = fragment.match(/^:(\w+)\??$/);
      if (!match) {
        return fragment;
      }

      const key = match[1] as string;
      const value = data[key];
      if (!value) {
        if (options?.ignoreMissing) {
          return fragment;
        }

        if (!fragment.endsWith('?')) {
          throw new Error(`missing url param ${key}`);
        }

        return '';
      }

      return encodeURIComponent(value as string | number | boolean);
    })
    .join('/')
    .replaceAll('//', '/');
}
