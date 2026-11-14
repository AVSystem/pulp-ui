// The theme follows the operating system until the user picks one. A stored
// value that is not a theme name (an older build stored the string "null" to
// mean "no choice") must never pin the page to a theme, and clearing the choice
// must leave nothing behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  followSystemTheme,
  getUserChoice,
  reflectPreference,
  setUserChoice,
} from 'src/darkmode';

const KEY = 'pulp-darkmode';
const DARK_CLASS = 'pf-v6-theme-dark';

type Listener = (event: { matches: boolean }) => void;

// A controllable stand-in for the prefers-color-scheme media query.
function mockSystemTheme(initiallyDark: boolean) {
  let dark = initiallyDark;
  const listeners = new Set<Listener>();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        get matches() {
          return dark;
        },
        addEventListener: (_type: string, listener: Listener) =>
          listeners.add(listener),
        removeEventListener: (_type: string, listener: Listener) =>
          listeners.delete(listener),
      }) as unknown as MediaQueryList,
  );
  return {
    change(nextDark: boolean) {
      dark = nextDark;
      listeners.forEach((listener) => listener({ matches: nextDark }));
    },
    listenerCount: () => listeners.size,
  };
}

const isDark = () => document.documentElement.classList.contains(DARK_CLASS);

beforeEach(() => {
  document.documentElement.classList.remove(DARK_CLASS);
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove(DARK_CLASS);
});

describe('setUserChoice', () => {
  it('stores dark and turns the dark theme on', () => {
    mockSystemTheme(false);
    setUserChoice('dark');
    expect(window.localStorage.getItem(KEY)).toBe('dark');
    expect(isDark()).toBe(true);
  });

  it('stores light and turns the dark theme off, whatever the system prefers', () => {
    mockSystemTheme(true);
    setUserChoice('dark');
    setUserChoice('light');
    expect(window.localStorage.getItem(KEY)).toBe('light');
    expect(isDark()).toBe(false);
  });

  it('removes the key for no choice and applies the system preference again', () => {
    mockSystemTheme(true);
    setUserChoice('light');
    setUserChoice(null);
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(Object.keys(window.localStorage)).not.toContain(KEY);
    expect(isDark()).toBe(true);
  });
});

describe('getUserChoice', () => {
  it('is null with nothing stored', () => {
    expect(getUserChoice()).toBeNull();
  });

  it.each(['dark', 'light'] as const)('reads a stored %s', (value) => {
    window.localStorage.setItem(KEY, value);
    expect(getUserChoice()).toBe(value);
  });

  it.each(['null', 'undefined', '', 'DARK', 'blue', '{}'])(
    'treats the stored value %j as no choice',
    (value) => {
      window.localStorage.setItem(KEY, value);
      expect(getUserChoice()).toBeNull();
    },
  );

  it('lets the system decide when the stored value is not a theme', () => {
    mockSystemTheme(true);
    window.localStorage.setItem(KEY, 'null');
    const stop = followSystemTheme();
    expect(isDark()).toBe(true);
    stop();
  });
});

describe('followSystemTheme', () => {
  it('applies the system preference at once when nothing is stored', () => {
    mockSystemTheme(true);
    const stop = followSystemTheme();
    expect(isDark()).toBe(true);
    stop();
  });

  it('follows the system while the page is open and nothing is stored', () => {
    const system = mockSystemTheme(false);
    const stop = followSystemTheme();
    expect(isDark()).toBe(false);
    system.change(true);
    expect(isDark()).toBe(true);
    system.change(false);
    expect(isDark()).toBe(false);
    stop();
  });

  it('ignores system changes once the user has chosen', () => {
    const system = mockSystemTheme(false);
    const stop = followSystemTheme();
    setUserChoice('light');
    system.change(true);
    expect(isDark()).toBe(false);
    setUserChoice('dark');
    system.change(false);
    expect(isDark()).toBe(true);
    stop();
  });

  it('follows the system again after the choice is cleared', () => {
    const system = mockSystemTheme(false);
    const stop = followSystemTheme();
    setUserChoice('dark');
    setUserChoice(null);
    system.change(true);
    expect(isDark()).toBe(true);
    stop();
  });

  it('stops listening when unsubscribed', () => {
    const system = mockSystemTheme(false);
    const stop = followSystemTheme();
    expect(system.listenerCount()).toBe(1);
    stop();
    expect(system.listenerCount()).toBe(0);
    system.change(true);
    expect(isDark()).toBe(false);
  });
});

describe('reflectPreference', () => {
  it('toggles the dark class', () => {
    reflectPreference('dark');
    expect(isDark()).toBe(true);
    reflectPreference('light');
    expect(isDark()).toBe(false);
  });
});
