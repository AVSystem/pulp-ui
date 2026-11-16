import { type Page, expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import {
  absentOptionalPlugin,
  expectNothingLoaded,
  expectPageShown,
  failureShown,
  listPages,
  missingPlugin,
  watchPage,
} from './list-pages';

// The same pages as the limited account sees them. A page its roles allow
// shows the title with no alert and no error state, and none of the controls
// that change something: no header action button, no actions menu on a row and
// no trailing actions cell. A page they do not allow is refused by the server
// with 403; it may show the title, or say so with an error, but an error of any
// other kind (404, 500, no answer) is a fault of the page. A screen the account
// may not open at all is replaced by the insufficient permissions page, and the
// application does not ask the server for that screen's data. None may ever meet
// the error boundary or an uncaught error. A placeholder, a not-found page and a
// not-installed page are shown to this account exactly as to the admin.

// The buttons that start something that changes data.
const changeButtons = (page: Page) =>
  page.getByRole('button', {
    name: /^(Add .+|Create .+|Edit|Sync|Delete|Remove|Upload .+|Import .+)$/,
  });

// What a row of a list draws for an action: the actions menu, and the
// right-aligned cell that holds it.
async function expectNoRowActions(page: Page): Promise<void> {
  await expect(page.locator('[data-cy=kebab-toggle]')).toHaveCount(0);
  await expect(
    page.locator('tbody td[style*="justify-content: flex-end"]'),
  ).toHaveCount(0);
}

// Resolves once the application has read the account's own roles, so that a
// control missing from a page is missing because of what the account holds and
// not because the read was still running.
function permissionsRead(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/pulp\/api\/v3\/users\/[^/]+\/roles\/$/.test(
        new URL(response.url()).pathname,
      ),
  );
}

for (const entry of listPages) {
  const how = entry.viewerNoScreen
    ? 'shows the insufficient permissions page'
    : entry.viewerRefused
      ? 'is refused with 403 or shows its title'
      : 'shows its title without an error or a control that changes data';
  test(`${entry.name} (${entry.path}) ${how}`, async ({ page }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    test.fail(!!entry.knownDefect?.viewer, entry.knownDefect?.viewer ?? '');

    const notInstalled = await absentOptionalPlugin(entry);
    const watch = watchPage(page);
    const rolesRead = permissionsRead(page);

    await page.goto(entry.path);
    if (entry.viewerNoScreen) {
      await expect(title(page, 'Insufficient permissions')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
    } else if (entry.viewerRefused) {
      await expect(
        title(page, entry.title).or(failureShown(page)).first(),
      ).toBeVisible();
    } else {
      await expectPageShown(page, entry, notInstalled);
    }
    await rolesRead;
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    expect(watch.errors, 'uncaught errors of the page').toEqual([]);

    if (entry.viewerNoScreen) {
      expect(watch.failed, 'API requests of the page that failed').toEqual([]);
      expect(
        watch.requests.filter((path) => path === `/pulp/api/v3/${entry.path}/`),
        'requests of the page for the data of the screen it did not show',
      ).toEqual([]);
      return;
    }

    if (!entry.viewerRefused) {
      await expect(failureShown(page)).toHaveCount(0);
      expect(watch.failed, 'API requests of the page that failed').toEqual([]);
      expectNothingLoaded(watch, entry, notInstalled);
      await expect(changeButtons(page)).toHaveCount(0);
      await expectNoRowActions(page);
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
