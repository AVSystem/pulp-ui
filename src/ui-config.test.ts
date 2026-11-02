import { describe, expect, it } from 'vitest';
import { config, configFallback, configPromise } from './ui-config';

describe('ui config', () => {
  it('keeps the served reserved base path prefixes as the deployment gave them', async () => {
    await configPromise;

    expect(config.RESERVED_BASE_PATH_PREFIXES).toStrictEqual([]);
  });

  it('marks the reserved base path prefixes unknown in the fallback and keeps the other defaults', () => {
    const fallback = configFallback();

    expect(fallback.RESERVED_BASE_PATH_PREFIXES).toBeNull();
    expect(fallback.API_BASE_PATH).toBe('/pulp/api/v3/');
    expect(fallback.UI_BASE_PATH).toBe('/ui/');
  });
});
