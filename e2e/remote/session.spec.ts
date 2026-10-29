import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';

// These tests run on the shared session of the admin account that the setup
// project saved. Tests that sign in or out never use it: they start from a
// context of their own, see the later tests in this file.

test('a deep link to a list page survives a reload', async ({ page }) => {
  await page.goto('file/repositories');
  await expect(title(page, 'Repositories')).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/ui\/file\/repositories\/?$/);
  await expect(title(page, 'Repositories')).toBeVisible();
});
