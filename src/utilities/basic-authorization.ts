// Builds the Authorization header value for a Basic login. The HTTP client's
// own auth option encodes Latin-1 only and throws on any other character, so
// a password with, say, a Polish letter would crash the login request. The
// credentials are encoded as UTF-8 bytes first, which is what the server
// decodes.
export function basicAuthorization(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    '',
  );
  return `Basic ${btoa(binary)}`;
}
