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
  await signInWith(page, account());
}

// The same, for an explicit account and starting from the plain login page.
export async function signInWith(
  page: Page,
  { username, password }: { username: string; password: string },
): Promise<void> {
  await page.goto('login');
  await submitLoginForm(page, username, password);

  await expect(title(page, 'Status')).toBeVisible();
  await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();
}

// Types a user name and password into the login form that is already open and
// submits it. What follows is up to the caller.
export async function submitLoginForm(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.locator('#pf-login-username-id').fill(username);
  await page.locator('#pf-login-password-id').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
}
