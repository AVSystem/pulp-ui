import { expect, test } from '@playwright/test';
import { account } from '../support/env';
import {
  backdropIsStill,
  coveredAt,
  endSessionBehindThePage,
  loginChecks,
  markWindow,
  returnToTab,
  windowMarked,
} from '../support/session-cover';
import { signIn } from '../support/sign-in';

// A session that ended behind the page, as another tab or an expiry would end
// it, must show on return: the page asks once, says the session has ended in a
// dialog, and keeps what it showed unreadable under an opaque layer from the
// first frame until the same account signs in again, with no reload. The return
// is dispatched inside the page, since a headless browser never tells a page
// that the user came back to it.
test('a session ended behind the page is covered on return and comes back after signing in through the dialog', async ({
  page,
}) => {
  await signIn(page);
  const workers = page.getByText('Online workers', { exact: true });
  const accountMenu = page.locator('[data-cy=user-dropdown]');
  await expect(workers).toBeVisible();
  const checks = loginChecks(page);
  await markWindow(page);

  expect(await endSessionBehindThePage(page)).toBe(204);
  await returnToTab(page, 'focus');

  await expect
    .poll(() => checks.statuses, { message: 'the check of the page' })
    .toEqual([401]);
  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  // The layer has no fade-in: it carries no animation class and nothing is
  // animating it, so it is opaque from its first frame. The covering is then
  // measured at once, without waiting for animations.
  expect(
    await backdropIsStill(page),
    'the backdrop has no animation class and no running animation',
  ).toBe(true);
  expect(
    await coveredAt(page, workers, false),
    'the data on the page is covered by the opaque layer',
  ).toBe(true);
  expect(
    await coveredAt(page, accountMenu, false),
    'the account menu is covered by the opaque layer',
  ).toBe(true);

  const { username, password } = account();
  await dialog.getByLabel('Username').fill(username);
  await dialog.getByLabel('Password').fill(password);
  await dialog.getByRole('button', { name: 'Log in' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(workers).toBeVisible();
  expect(
    await coveredAt(page, workers),
    'the data is back and not covered',
  ).toBe(false);
  expect(await windowMarked(page), 'the page was not reloaded').toBe(true);
});
