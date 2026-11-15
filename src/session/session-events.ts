import { useSyncExternalStore } from 'react';

// Where the static page for a signed-out user lives. Shared so the dialog and
// that page agree on the address.
export const SIGNED_OUT_PATH = '/signed-out';

// Whether the session of the signed-in user has ended, and whether a request
// found out (as opposed to a check made on returning to the tab).
export interface ISessionEnded {
  ended: boolean;
  fromRequest: boolean;
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
