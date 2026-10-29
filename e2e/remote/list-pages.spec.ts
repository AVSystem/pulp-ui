import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import { listPages, missingPlugin } from './list-pages';

// Every list page of every installed plugin, and of Pulp core, opens for the
// admin account with its title, without the error boundary, without an error
// alert and without an uncaught error in the page.

for (const entry of listPages) {
  test(`${entry.name} (${entry.path}) opens`, async ({ page }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    test.fixme(!!entry.fixme?.admin, entry.fixme?.admin ?? '');

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(entry.path);
    await expect(title(page, entry.title)).toBeVisible();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    await expect(page.locator('.pf-v5-c-alert.pf-m-danger')).toHaveCount(0);
    expect(errors, 'uncaught errors of the page').toEqual([]);
  });
}
