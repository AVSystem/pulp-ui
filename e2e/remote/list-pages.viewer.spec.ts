import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import { listPages, missingPlugin } from './list-pages';

// The same pages as the limited account sees them. Whatever it may not read is
// refused by the server, and the page says so with an error alert; what it must
// never meet is the error boundary or an uncaught error.

for (const entry of listPages) {
  test(`${entry.name} (${entry.path}) shows its title or an error alert`, async ({
    page,
  }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    test.fixme(!!entry.fixme?.viewer, entry.fixme?.viewer ?? '');

    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto(entry.path);
    await expect(
      title(page, entry.title)
        .or(page.locator('.pf-v5-c-alert.pf-m-danger'))
        .first(),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    expect(errors, 'uncaught errors of the page').toEqual([]);
  });
}
