import { z } from 'zod';

// The one rule for an object address (pulp_href) that came from the server.
// An address is kept in application state and later decides where a request
// goes, so only a same-origin path is accepted: it starts with a single slash.
// A protocol-relative value (//host, and /\host which browsers read the same
// way), an absolute URL, an empty string, and anything holding whitespace or a
// control character is refused, so a tampered answer cannot send a later
// request, or the credentials it carries, to another host.
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) {
      return true;
    }
  }
  return false;
}

export const pulpHrefSchema = z
  .string()
  .startsWith('/', {
    error: 'pulp_href must be a path that starts with a slash',
  })
  .refine((value) => !value.startsWith('//') && !value.startsWith('/\\'), {
    error: 'pulp_href must not have a leading double slash',
  })
  .refine((value) => !/\s/.test(value) && !hasControlCharacter(value), {
    error: 'pulp_href must not contain whitespace or control characters',
  });
