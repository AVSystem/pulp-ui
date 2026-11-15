import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getSnapshot,
  isSuspended,
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
  subscribe,
} from './session-events';

afterEach(() => {
  resetSessionEvents();
});

describe('session events', () => {
  it('starts with a session that has not ended', () => {
    expect(getSnapshot()).toEqual({ ended: false, fromRequest: false });
    expect(isSuspended()).toBe(false);
  });

  it('ignores a refused request while nobody is signed in', () => {
    reportUnauthorized('request');

    expect(getSnapshot().ended).toBe(false);
    expect(isSuspended()).toBe(false);
  });

  it('a refused request with a signed-in user ends the session and notes the request', () => {
    setSignedIn(true);

    reportUnauthorized('request');

    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
    expect(isSuspended()).toBe(true);
  });

  it('a refusal found by the tab-return check ends the session without a request note', () => {
    setSignedIn(true);

    reportUnauthorized('tab-return');

    expect(getSnapshot()).toEqual({ ended: true, fromRequest: false });
  });

  it('a request refused after the tab-return check adds the request note', () => {
    setSignedIn(true);
    reportUnauthorized('tab-return');

    reportUnauthorized('request');

    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
  });

  it('several refusals at once tell the listeners once', () => {
    setSignedIn(true);
    const listener = vi.fn();
    subscribe(listener);

    reportUnauthorized('request');
    reportUnauthorized('request');
    reportUnauthorized('request');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('resume clears the ended session and tells the listeners', () => {
    setSignedIn(true);
    reportUnauthorized('request');
    const listener = vi.fn();
    subscribe(listener);

    resume();

    expect(getSnapshot()).toEqual({ ended: false, fromRequest: false });
    expect(isSuspended()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('signing out clears an ended session and later refusals are ignored', () => {
    setSignedIn(true);
    reportUnauthorized('request');

    setSignedIn(false);
    reportUnauthorized('request');

    expect(getSnapshot().ended).toBe(false);
  });

  it('a listener that unsubscribed hears nothing more', () => {
    setSignedIn(true);
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);
    unsubscribe();

    reportUnauthorized('request');

    expect(listener).not.toHaveBeenCalled();
  });

  it('keeps the same snapshot object while nothing changed', () => {
    setSignedIn(true);
    const before = getSnapshot();

    resume();
    setSignedIn(true);

    expect(getSnapshot()).toBe(before);
  });
});
