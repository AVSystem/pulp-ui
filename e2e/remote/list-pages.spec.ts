import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import {
  failureShown,
  listPages,
  missingExpectedPlugins,
  missingPlugin,
  missingPluginsAllowed,
  watchPage,
} from './list-pages';

// Every list page of every installed plugin, and of Pulp core, opens for the
// admin account with its title, without the error boundary, without an error
// alert or error state and without an uncaught error in the page.

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

    const watch = watchPage(page);

    await page.goto(entry.path);
    await expect(title(page, entry.title)).toBeVisible();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    await expect(failureShown(page)).toHaveCount(0);
    expect(watch.errors, 'uncaught errors of the page').toEqual([]);
  });
}
