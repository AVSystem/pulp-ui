import { expect, test } from '@playwright/test';
import {
  absentOptionalPlugin,
  expectNothingLoaded,
  expectPageShown,
  failureShown,
  listPages,
  missingExpectedPlugins,
  missingPlugin,
  missingPluginsAllowed,
  watchPage,
} from './list-pages';

// Every list page of every installed plugin, and of Pulp core, opens for the
// admin account with its title, without the error boundary, without an error
// alert or error state and without an uncaught error in the page. A screen
// this UI does not have shows its placeholder, a route that no longer exists
// shows the not-found page, and a page of an optional plugin the server does
// not run says the plugin is not installed; none of them sends a failing
// request or a request to an endpoint only galaxy_ng serves.

test.beforeAll(async () => {
  if (missingPluginsAllowed()) {
    return;
  }
  expect(
    await missingExpectedPlugins(),
    'plugins the server does not run (set PULP_UI_E2E_ALLOW_MISSING_PLUGINS to skip their pages)',
  ).toEqual([]);
});

for (const entry of listPages) {
  test(`${entry.name} (${entry.path}) opens`, async ({ page }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    // runs anyway: the run reports it the day the page works
    test.fail(!!entry.knownDefect?.admin, entry.knownDefect?.admin ?? '');

    const notInstalled = await absentOptionalPlugin(entry);
    const watch = watchPage(page);

    await page.goto(entry.path);
    await expectPageShown(page, entry, notInstalled);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    await expect(failureShown(page)).toHaveCount(0);
    expect(watch.errors, 'uncaught errors of the page').toEqual([]);
    expectNothingLoaded(watch, entry, notInstalled);
  });
}
