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
// The rejection msw produces for a request without a handler is caught by most
// screens (they turn a failed read into an alert or ignore it), so the test
// would pass on a request nobody answered. Recording the request lets the
// check after each test fail it anyway. The record is kept by the strategy
// itself and not by a listener of the request:unhandled event, because many
// tests remove every listener of the server when they finish a step, which
// would silence a listener for the rest of the test. The strategy still
// rejects the request as the plain 'error' strategy does.
server.listen({
  onUnhandledRequest: (request, print) => {
    // The same request reaches the mock server at two layers of the fetch
    // implementation; one record is enough to fail the test.
    const entry = `${request.method} ${request.url}`;
    if (!unhandledRequests.includes(entry)) {
      unhandledRequests.push(entry);
    }
    print.error();
  },
});

// Requests made while the configuration module loads have settled before the
// first test body runs, so request code that reads the configuration never
// sees it unset.
let resetPluginVersionsCache: () => void = () => undefined;
beforeAll(async () => {
  const { configPromise } = await import('src/ui-config');
  await configPromise;
  // The generated client resolves every URL through the application's rules.
  const { installSdkRequestPolicy } = await import('src/entities/sdk-setup');
  installSdkRequestPolicy();
  // Imported here for the same reason: the module reads the configuration.
  ({ resetPluginVersionsCache } = await import('src/utilities/plugin-version'));
});

afterEach(async () => {
  // Unmounting runs the effects a render still had pending, and one of them
  // may start the read of the installed plugins; it must happen before the
  // cache is cleared, or its answer would stay cached for the next test.
  cleanup();
  // A request a screen sent just before the test ended, or while it unmounted,
  // reaches the mock server a moment later. It must meet the handlers of the
  // test that sent it: after the handlers are reset it would count as an
  // unmocked request of the next test.
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Handlers added by one test never leak into the next one.
  server.resetHandlers();
  // The installed plugins are cached for the page's lifetime; a test must not
  // inherit the answer of the one before it.
  resetPluginVersionsCache();
  window.localStorage.clear();
  window.sessionStorage.clear();

  // Listeners a test or a helper added never reach the next test, even when
  // the test failed before it could remove them.
  server.events.removeAllListeners();

  // Last, so the failure names the test that sent the request. Requests a
  // screen sent while it unmounted are in the record by now.
  const unhandled = takeUnhandledRequests();
  if (unhandled.length > 0) {
    throw new Error(`Requests without a mock handler: ${unhandled.join(', ')}`);
  }
});

afterAll(() => {
  server.events.removeAllListeners();
  server.close();
});
