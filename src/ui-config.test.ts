import { describe, expect, it, vi } from 'vitest';

// The module keeps the configuration in a variable that the fallback
// overwrites, so every test reads it from a freshly evaluated module and the
// outcome does not depend on the order the tests run in.
const freshModule = async () => {
  vi.resetModules();
  return import('./ui-config');
};

describe('ui config', () => {
  it('keeps the served reserved base path prefixes as the deployment gave them', async () => {
    const uiConfig = await freshModule();
    await uiConfig.configPromise;

    expect(uiConfig.config.RESERVED_BASE_PATH_PREFIXES).toStrictEqual([]);
  });

  it('marks the reserved base path prefixes unknown in the fallback and keeps the other defaults', async () => {
    const { configFallback } = await freshModule();

    const fallback = configFallback();

    expect(fallback.RESERVED_BASE_PATH_PREFIXES).toBeNull();
    expect(fallback.API_BASE_PATH).toBe('/pulp/api/v3/');
    expect(fallback.UI_BASE_PATH).toBe('/ui/');
  });
});
