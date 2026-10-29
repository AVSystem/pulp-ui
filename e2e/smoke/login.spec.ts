import { expect, test } from '@playwright/test';
import { account, baseUrl } from '../support/env';

test('signing in through the form lands on Status with the workers list', async ({
  page,
}) => {
  baseUrl();
  const { username, password } = account();

  await page.goto('login');
  await page.locator('#pf-login-username-id').fill(username);
  await page.locator('#pf-login-password-id').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(
    page.locator('.pf-v5-c-title', { hasText: 'Status' }),
  ).toBeVisible();
  await expect(page.getByText('Online workers')).toBeVisible();
});
