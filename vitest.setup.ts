import { i18n } from '@lingui/core';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from 'src/test-utils/server';

// Without a catalog, every message renders as its source text.
i18n.loadAndActivate({ locale: 'en', messages: {} });

// The mock server must listen before any test module is evaluated: the
// application fetches its configuration file while it is imported, so a server
// started in beforeAll would come too late and that request would go to the
// real network. A request without a handler fails the test, so no test can
// reach a real host.
server.listen({ onUnhandledRequest: 'error' });

// Requests made while the configuration module loads have settled before the
// first test body runs, so request code that reads the configuration never
// sees it unset.
let resetPluginVersionsCache: () => void = () => undefined;
beforeAll(async () => {
  const { configPromise } = await import('src/ui-config');
  await configPromise;
  // Imported here for the same reason: the module reads the configuration.
  ({ resetPluginVersionsCache } = await import('src/utilities/plugin-version'));
});

// Handlers added by one test never leak into the next one.
afterEach(() => {
  server.resetHandlers();
  // The installed plugins are cached for the page's lifetime; a test must not
  // inherit the answer of the one before it.
  resetPluginVersionsCache();
  cleanup();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterAll(() => server.close());
