const LOGIN_PATH = /^\/login\/?$/;

// Returns the after-login target only when it is a same-origin path, else the
// fallback. A value from the query string must never send a signed-in user to
// another site, so only a string with a single leading slash passes: not a
// protocol-relative URL ('//host'), not a slash-backslash pair that browsers
// read as one, not an absolute URL, and nothing carrying control characters.
// The login page itself is refused to avoid bouncing back to the form.
export function safeNextPath(next: unknown, fallback: string): string {
  if (typeof next !== 'string' || next.charAt(0) !== '/') {
    return fallback;
  }
  const second = next.charAt(1);
  if (second === '/' || second === '\\') {
    return fallback;
  }
  for (let index = 0; index < next.length; index++) {
    const code = next.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) {
      return fallback;
    }
  }
  const pathPart = next.split(/[?#]/)[0];
  return LOGIN_PATH.test(pathPart) ? fallback : next;
}
