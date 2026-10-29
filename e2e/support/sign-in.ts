import { type Page, expect } from '@playwright/test';
import { account, baseUrl } from './env';

// The page title as the application renders it.
export function title(page: Page, text: string) {
  return page.locator('.pf-v5-c-title', { hasText: text }).first();
}

// Fills in the login form with the account of the run and submits it, the way
// a person does; no credential is ever placed in storage by the test. Ends on
// the Status page, where the application sends a fresh sign-in.
export async function signIn(page: Page): Promise<void> {
  baseUrl();
  const { username, password } = account();

  await page.goto('login');
  await page.locator('#pf-login-username-id').fill(username);
  await page.locator('#pf-login-password-id').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  await expect(title(page, 'Status')).toBeVisible();
  await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();
}
