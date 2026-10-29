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
  await signIn(page);

  await page.locator('[data-cy=user-dropdown]').click();
  await page.getByText('Logout', { exact: true }).click();

  // signed out: the menu offers Login instead of the user dropdown
  await page.locator('[data-cy=pulp-menu-item-Login]').click();
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
