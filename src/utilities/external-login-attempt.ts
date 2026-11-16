import { readStored, removeStored, writeStored } from './safe-storage';

// The time the page last sent the browser to the external login, kept for the
// life of the tab. A page that comes back without a session soon after is a
// sign-in that did not complete, and sending the browser away again would only
// start a loop.
export const EXTERNAL_LOGIN_AT_KEY = 'pulp-ui-external-login-at';

export function rememberExternalLogin(now: number) {
  writeStored(EXTERNAL_LOGIN_AT_KEY, String(now), 'sessionStorage');
}

export function forgetExternalLogin() {
  removeStored(EXTERNAL_LOGIN_AT_KEY, 'sessionStorage');
}

// How long ago the browser was last sent to the external login, in
// milliseconds, or null when it was not, the time cannot be read, or the stored
// time lies in the future (a clock that moved back would otherwise make every
// later attempt look recent).
export function externalLoginAge(now: number): number | null {
  const stored = readStored(EXTERNAL_LOGIN_AT_KEY, 'sessionStorage');
  if (stored === null) {
    return null;
  }
  const at = Number(stored);
  return Number.isFinite(at) && at <= now ? now - at : null;
}
