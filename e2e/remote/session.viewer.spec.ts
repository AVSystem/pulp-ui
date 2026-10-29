import { expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { title } from '../support/sign-in';

// Runs on the shared session of the limited account that the setup project
// saved: the application opens signed in as that account.
test('the viewer account opens the application signed in as itself', async ({
  page,
}) => {
  await page.goto('status');

  await expect(title(page, 'Status')).toBeVisible();
  await expect(page.locator('[data-cy=user-dropdown]')).toContainText(
    account('viewer').username,
  );
});
