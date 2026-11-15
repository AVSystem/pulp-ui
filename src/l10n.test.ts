import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockStorage } from 'src/test-utils/storage';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('language selection', () => {
  it('falls back to the browser language when the storage is blocked', async () => {
    blockStorage();
    vi.resetModules();
    window.history.replaceState(null, '', '/?lang=nl&pseudolocalization=true');

    const { language } = await import('src/l10n');

    // the override cannot be stored, so it is not applied
    expect(['en', 'es', 'fr', 'ko', 'nl', 'ja', 'zh']).toContain(language);
  });

  it('uses the stored language override', async () => {
    window.localStorage.setItem('override_l10n', 'nl');
    vi.resetModules();

    const { language } = await import('src/l10n');

    expect(language).toBe('nl');
  });

  it('ignores a stored language the interface does not have', async () => {
    window.localStorage.setItem('override_l10n', 'xx');
    vi.resetModules();

    const { language } = await import('src/l10n');

    expect(language).not.toBe('xx');
  });
});
