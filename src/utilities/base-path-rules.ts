// Base path rules for distributions. They mirror the server's base path
// validation (exact, case-sensitive comparison; a path may not equal, contain
// or sit under another distribution's path), so the form can refuse a conflict
// before anything is created instead of leaving a repository without its
// distribution. Functions return codes, never translated text.

export type BasePathProblem = 'empty' | 'slash' | 'characters';

const DISALLOWED = /[^-a-zA-Z0-9_/]/;

function isAllowed(character: string): boolean {
  return !DISALLOWED.test(character);
}

// Turns free text (for example a repository name) into a valid base path:
// every code point outside [-a-zA-Z0-9_/] becomes one underscore, repeated
// slashes collapse and leading or trailing slashes are dropped. Iterating by
// code point keeps an emoji from turning into two underscores.
export function sanitizeBasePath(text: string): string {
  return Array.from(text)
    .map((character) => (isAllowed(character) ? character : '_'))
    .join('')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

// Reports why a typed base path would be rejected, or null when it is fine.
export function basePathProblem(path: string): BasePathProblem | null {
  if (!path) {
    return 'empty';
  }
  if (path.startsWith('/') || path.endsWith('/') || path.includes('//')) {
    return 'slash';
  }
  if (Array.from(path).some((character) => !isAllowed(character))) {
    return 'characters';
  }
  return null;
}

// The path itself and every ancestor, shortest first: 'a/b/c' gives
// ['a', 'a/b', 'a/b/c']. These are the paths a new distribution would collide
// with by being equal to, or nested under, an existing one.
export function basePathAncestors(path: string): string[] {
  if (!path) {
    return [];
  }
  const segments = path.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

// True when `path` is strictly nested under `ancestor` on a segment boundary.
// A path is not under itself and 'debian' is not under 'deb'.
export function isUnderBasePath(path: string, ancestor: string): boolean {
  return ancestor !== '' && path.startsWith(`${ancestor}/`);
}

// Returns the configured prefix that `path` falls under, or null. A prefix is
// treated as if it ended in exactly one slash and the path is compared with a
// slash appended, so a match is always on a segment boundary: 'deb' and
// 'deb/x' match 'deb/', 'debian/x' does not. The prefix is returned as
// configured. Empty prefixes are ignored; without a list nothing is reserved.
export function reservedPrefixFor(
  path: string,
  prefixes?: string[] | null,
): string | null {
  const candidate = `${path}/`;
  for (const prefix of prefixes || []) {
    const normalized = prefix.replace(/\/+$/, '');
    if (normalized && candidate.startsWith(`${normalized}/`)) {
      return prefix;
    }
  }
  return null;
}
