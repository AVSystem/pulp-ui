import { i18n } from '@lingui/core';
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import {
  server,
  takeUnhandledRequests,
  unhandledRequests,
} from 'src/test-utils/server';

// Without a catalog, every message renders as its source text.
i18n.loadAndActivate({ locale: 'en', messages: {} });

// The mock server must listen before any test module is evaluated: the
// application fetches its configuration file while it is imported, so a server
// started in beforeAll would come too late and that request would go to the
// real network. A request without a handler fails the test, so no test can
// reach a real host.
server.listen({ onUnhandledRequest: 'error' });

// The rejection msw produces for a request without a handler is caught by most
// screens (they turn a failed read into an alert or ignore it), so the test
// would pass on a request nobody answered. Recording the request lets the
// check after each test fail it anyway.
const recordUnhandled = () =>
  server.events.on('request:unhandled', ({ request }) => {
    unhandledRequests.push(`${request.method} ${request.url}`);
  });
recordUnhandled();

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
  // Unmounting runs the effects a render still had pending, and one of them
  // may start the read of the installed plugins; it must happen before the
  // cache is cleared, or its answer would stay cached for the next test.
  cleanup();
  // The installed plugins are cached for the page's lifetime; a test must not
  // inherit the answer of the one before it.
  resetPluginVersionsCache();
  window.localStorage.clear();
  window.sessionStorage.clear();

  // Listeners a test or a helper added never reach the next test, even when
  // the test failed before it could remove them; the recorder is added again.
  server.events.removeAllListeners();
  recordUnhandled();

  // Last, so the failure names the test that sent the request. Requests a
  // screen sent while it unmounted are in the record by now.
  const unhandled = takeUnhandledRequests();
  if (unhandled.length > 0) {
    throw new Error(
      `Requests without a mock handler: ${unhandled.join(', ')}`,
    );
  }
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});
