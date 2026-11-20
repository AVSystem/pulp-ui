import { z } from 'zod';
import { config } from 'src/ui-config';

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

// The plugins whose repositories, remotes and distributions an address can
// name: the segment after "repositories/", "remotes/" or "distributions/".
export const HREF_PLUGINS = [
  'file',
  'deb',
  'rpm',
  'python',
  'ansible',
] as const;
export type HrefPlugin = (typeof HREF_PLUGINS)[number];

// The plugin a repository, repository version, remote or distribution address
// belongs to. Anything else answers nothing.
export function pluginOfHref(
  href: string | null | undefined,
): HrefPlugin | undefined {
  const segment = /\/(?:repositories|remotes|distributions)\/([^/]+)\//.exec(
    href ?? '',
  )?.[1];

  return HREF_PLUGINS.find((plugin) => plugin === segment);
}

// A repository version address ends in /versions/<number>/. The number is a
// whole number without a sign or leading zeros; the address of the list of
// versions, of anything below a version and one with a query or fragment is
// not a version address.
const VERSION_HREF = /^(\/.*\/)versions\/(0|[1-9][0-9]*)\/?$/;

function versionParts(
  href: string | null | undefined,
): { repository: string; number: number } | null {
  if (typeof href !== 'string' || !pulpHrefSchema.safeParse(href).success) {
    return null;
  }
  const match = VERSION_HREF.exec(href);
  if (!match) {
    return null;
  }
  const number = Number(match[2]);

  return Number.isSafeInteger(number) && match[1].includes('/repositories/')
    ? { repository: match[1], number }
    : null;
}

// The number of the version a repository version address names, or null when
// it names anything else. This is the one place a version number is read out
// of an address.
export function versionNumberOf(
  href: string | null | undefined,
): number | null {
  return versionParts(href)?.number ?? null;
}

// The address of the repository a version address belongs to, or null when it
// is not a version address.
export function repositoryOfVersion(
  href: string | null | undefined,
): string | null {
  return versionParts(href)?.repository ?? null;
}

// The path of an object address below the API base ("repositories/file/file/
// <id>/"), or null when the address is not an object address of this API:
// outside the base, the base itself, an absolute URL, a query or fragment, a
// backslash, or a dot segment or slash hidden in an escape. The result is safe
// to append to the base, so no request it builds can leave the API.
export function apiPathOfHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string' || !pulpHrefSchema.safeParse(href).success) {
    return null;
  }
  const base: string = config.API_BASE_PATH;
  if (
    !href.startsWith(base) ||
    href.length === base.length ||
    /[?#\\]/.test(href)
  ) {
    return null;
  }

  const path = href.slice(base.length);
  const safe = path.split('/').every((segment) => {
    try {
      const decoded = decodeURIComponent(segment);
      return decoded !== '.' && decoded !== '..' && !/[/\\]/.test(decoded);
    } catch {
      return false;
    }
  });

  return safe ? path : null;
}
