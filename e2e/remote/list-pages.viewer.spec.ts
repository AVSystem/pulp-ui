import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import {
  failureShown,
  listPages,
  missingPlugin,
  watchPage,
} from './list-pages';

// The same pages as the limited account sees them. A page its roles allow
// shows the title with no alert and no error state. A page they do not allow
// is refused by the server with 403; it may show the title, or say so with an
// error, but an error of any other kind (404, 500, no answer) is a fault of
// the page. Neither may ever meet the error boundary or an uncaught error.

for (const entry of listPages) {
  const how = entry.viewerRefused
    ? 'is refused with 403 or shows its title'
    : 'shows its title without an error';
  test(`${entry.name} (${entry.path}) ${how}`, async ({ page }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    test.fail(!!entry.knownDefect?.viewer, entry.knownDefect?.viewer ?? '');

    const watch = watchPage(page);

    await page.goto(entry.path);
    if (entry.viewerRefused) {
      await expect(
        title(page, entry.title).or(failureShown(page)).first(),
      ).toBeVisible();
    } else {
      await expect(title(page, entry.title)).toBeVisible();
    }
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    expect(watch.errors, 'uncaught errors of the page').toEqual([]);

    if (!entry.viewerRefused) {
      await expect(failureShown(page)).toHaveCount(0);
      expect(watch.failed, 'API requests of the page that failed').toEqual([]);
      return;
    }

    if ((await failureShown(page).count()) > 0) {
      expect(
        watch.failed.length,
        'the page shows an error, so a request failed',
      ).toBeGreaterThan(0);
    }
    expect(
      watch.failed.filter(({ status }) => status !== 403),
      'failed API requests of the page that are not 403',
    ).toEqual([]);
  });
}
