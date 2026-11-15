import { useSyncExternalStore } from 'react';
import { Paths } from 'src/paths';

// Where the static page for a signed-out user lives. Shared so the dialog and
// that page agree on the address.
export const SIGNED_OUT_PATH = Paths.meta.signedOut;

// Whether the session of the signed-in user has ended, and whether a request
// found out (as opposed to a check made on returning to the tab).
export interface ISessionEnded {
  ended: boolean;
  fromRequest: boolean;
}

// The rejection of a request that was not sent because the session has ended
// and the user is signing in again. Nothing was asked of the server, so the
// failure is not about the data: callers treat it like a refused request and
// leave the explaining to the sign-in dialog.
export class SessionSuspendedError extends Error {
  constructor() {
    super('The request was held back while the session is being renewed.');
    this.name = 'SessionSuspendedError';
  }
}

// A tiny store shared by the API layer, which has no React around it, and the
// screens that react to a refused request.
let signedIn = false;
let snapshot: ISessionEnded = { ended: false, fromRequest: false };
const listeners = new Set<() => void>();

function publish(next: ISessionEnded) {
  if (
    next.ended === snapshot.ended &&
    next.fromRequest === snapshot.fromRequest
  ) {
    return;
  }
  snapshot = next;
  listeners.forEach((listener) => listener());
}

// The session counts as ended only for a user who was signed in during this
// page load: a refusal for a visitor who never signed in is not an ended
// session.
export function reportUnauthorized(origin: 'request' | 'tab-return') {
  if (!signedIn) {
    return;
  }
  publish({
    ended: true,
    fromRequest: snapshot.fromRequest || origin === 'request',
  });
}

// The user signed in again; the session is usable.
export function resume() {
  publish({ ended: false, fromRequest: false });
}

// True while a user who signed in during this page load has not been signed
// out.
export function isSignedIn() {
  return signedIn;
}

// The request that found out the session had ended is marked, so the screen
// that asked for the data treats the failure like any other session end: the
// sign-in dialog explains it and no alert is added.
const SESSION_END_MARK = 'endedSession';

export function markSessionEnd(error: unknown) {
  if (error && typeof error === 'object') {
    (error as Record<string, unknown>)[SESSION_END_MARK] = true;
  }
}

export function isMarkedSessionEnd(error: unknown): boolean {
  return (
    Boolean(error) &&
    typeof error === 'object' &&
    (error as Record<string, unknown>)[SESSION_END_MARK] === true
  );
}

export function setSignedIn(value: boolean) {
  signedIn = value;
  if (!value) {
    resume();
  }
}

// True while the session has ended and the user has not signed in again.
export function isSuspended() {
  return snapshot.ended;
}

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot() {
  return snapshot;
}

// Puts the store back to its start, for tests.
export function resetSessionEvents() {
  signedIn = false;
  snapshot = { ended: false, fromRequest: false };
  listeners.clear();
}

export function useSessionEnded() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
