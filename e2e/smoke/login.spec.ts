import { expect, test } from '@playwright/test';
import { signIn, title } from '../support/sign-in';

test('signing in through the form lands on Status with the workers list', async ({
  page,
}) => {
  await signIn(page);

  await expect(title(page, 'Status')).toBeVisible();
  await expect(page.getByText('Online workers')).toBeVisible();
});

test('logging out and signing in again through the menu ends on Status', async ({
  page,
}) => {
  // The API requests of the page, in the order they were sent.
  const requests: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.includes('/api/v3/')) {
      requests.push(`${request.method()} ${pathname}`);
    }
  });

  await signIn(page);
  // The heading of the screen that is mounted while signed in: a screen that is
  // mounted afresh after the sign out replaces it, so the old element ends up
  // detached.
  const heading = await page
    .getByRole('main')
    .getByRole('heading', { level: 1 })
    .first()
    .elementHandle();
  expect(heading).not.toBeNull();

  const loggedOut = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.endsWith('/api/v3/login/'),
  );
  await page.locator('[data-cy=user-dropdown]').click();
  await page.getByText('Logout', { exact: true }).click();
  await loggedOut;

  // Status needs no session and stays on screen, so it must read again
  // without the session instead of keeping what it read with it, on a screen
  // that is mounted afresh. Nothing is asserted about what the answer holds: a
  // stock Pulp answers everyone in full.
  await expect
    .poll(() => heading?.evaluate((element) => element.isConnected), {
      message: 'the screen mounted before the sign out is gone',
    })
    .toBe(false);
  await expect
    .poll(() => {
      const at = requests.findIndex(
        (entry) =>
          entry.startsWith('DELETE ') && entry.endsWith('/api/v3/login/'),
      );
      return (
        at >= 0 &&
        requests
          .slice(at + 1)
          .some(
            (entry) =>
              entry.startsWith('GET ') && entry.endsWith('/api/v3/status/'),
          )
      );
    })
    .toBe(true);

  // signed out: the menu offers Login instead of the user dropdown
  await page.locator('[data-cy=pulp-menu-item-login]').click();
  await expect(title(page, 'Login')).toBeVisible();

  await signIn(page);
  await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();
});

test('the login page of the production build shows its own texts', async ({
  page,
}) => {
  await page.goto('login');

  // a build without message catalogs would show the raw message ids here
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
});
