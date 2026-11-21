import { type Page, expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { coveredAt, loginChecks, returnToTab } from '../support/session-cover';
import { title } from '../support/sign-in';
import {
  apiLogin,
  logOutThroughMenu,
  logOutWhatRemains,
  signedOut,
  userMenu,
} from './session-helpers';

// One browser context holds one cookie jar, so every tab of it shares a single
// server session. It is a context of its own with a fresh sign in, because
// logging out ends the session for everything that uses it.
test.use({ storageState: signedOut });

// A test that signed in again leaves a live session on the server unless it is
// ended: end whatever session the context still holds.
test.afterEach(async ({ page, context }) => {
  await logOutWhatRemains(page, context);
});

test('after logging out in one tab, the other tab is refused by the server, asks to sign in again and shows the sign-in page on reload', async ({
  context,
}) => {
  await apiLogin(context);

  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('file/repositories');
  await tabB.goto('file/repositories');
  await expect(title(tabA, 'Repositories')).toBeVisible();
  await expect(title(tabB, 'Repositories')).toBeVisible();
  // A list reads more than its rows: every column that comes from a read of its
  // own is still on its way after the title shows. Tab B must have everything
  // it asked for before the session ends, or a late answer would be the
  // refusal this test means to cause by moving on.
  for (const tab of [tabA, tabB]) {
    await expect(
      tab.locator(
        'table[aria-label="Repositories"][data-columns-loaded="true"]',
      ),
    ).toBeVisible();
  }

  const answers: number[] = [];
  tabB.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/pulp/api/')) {
      answers.push(response.status());
    }
  });

  await logOutThroughMenu(tabA);

  // Tab B is not reloaded: it moves on to another list page inside the app.
  await tabB.locator('[data-cy="pulp-menu-item-tasks"]').click();

  await expect
    .poll(() => answers, { message: 'the server refuses tab B' })
    .toContain(401);

  // Nothing may crash the page: it says the session has ended in a dialog that
  // stays over the screen it left, and does not repeat the request.
  await expect(tabB.getByText('The stack trace is:')).toHaveCount(0);
  await expect(
    tabB.getByRole('dialog', { name: 'Sign in again' }),
  ).toBeVisible();

  await tabB.reload();
  await expect(tabB.locator('#pf-login-username-id')).toBeVisible();
});

// The Status screen reads data that only an administrator sees. One tab ends
// the session; the other tab, on returning to it, must not leave that data
// readable behind the sign-in dialog, and shows it again once the same account
// signs in through the dialog. The return is dispatched inside the page, since
// a headless browser never tells a page that the user came back to it.
test('after logging out on the Status screen in one tab, the other tab covers the staff data on its return and shows it again after the same account signs in through the dialog', async ({
  context,
}) => {
  await apiLogin(context);

  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('status');
  await tabB.goto('status');
  const workers = (page: Page) =>
    page.getByText('Online workers', { exact: true });
  await expect(workers(tabA)).toBeVisible();
  await expect(workers(tabB)).toBeVisible();
  const checks = loginChecks(tabB);

  // Tab A shows the answer for a visitor: no staff data, and the note that says
  // why.
  await logOutThroughMenu(tabA);
  await expect(workers(tabA)).toHaveCount(0);
  await expect(
    tabA.getByText(
      'Versions, workers and storage are shown to signed-in users.',
    ),
  ).toBeVisible();

  await returnToTab(tabB, 'visibility');
  await expect
    .poll(() => checks.statuses, { message: 'the check of tab B' })
    .toEqual([401]);
  const dialog = tabB.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  expect(
    await coveredAt(tabB, workers(tabB)),
    'the staff data of tab B is covered by the opaque layer',
  ).toBe(true);
  expect(
    await coveredAt(tabB, tabB.locator(userMenu)),
    'the account menu of tab B is covered by the opaque layer',
  ).toBe(true);

  await dialog.getByLabel('Password').fill(account('admin').password);
  await dialog.getByRole('button', { name: 'Log in' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(workers(tabB)).toBeVisible();
  expect(
    await coveredAt(tabB, workers(tabB)),
    'the staff data of tab B is back and not covered',
  ).toBe(false);
});
