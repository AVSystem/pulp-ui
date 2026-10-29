import { expect, test } from '@playwright/test';
import { title } from '../support/sign-in';
import { apiLogin, logOutThroughMenu, signedOut } from './session-helpers';

// One browser context holds one cookie jar, so every tab of it shares a single
// server session. It is a context of its own with a fresh sign in, because
// logging out ends the session for everything that uses it.
test.use({ storageState: signedOut });

test('after logging out in one tab, the other tab is refused by the server and recovers on reload', async ({
  context,
}) => {
  await apiLogin(context);

  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('file/repositories');
  await tabB.goto('file/repositories');
  await expect(title(tabA, 'Repositories')).toBeVisible();
  await expect(title(tabB, 'Repositories')).toBeVisible();

  const answers: number[] = [];
  tabB.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/pulp/api/')) {
      answers.push(response.status());
    }
  });

  await logOutThroughMenu(tabA);

  // Tab B is not reloaded: it moves on to another list page inside the app.
  await tabB.locator('[data-cy="pulp-menu-item-Task management"]').click();

  await expect
    .poll(() => answers, { message: 'the server refuses tab B' })
    .toContain(401);

  // Nothing may crash the page. What it shows may be the request's error or
  // the login page, both are a correct way to say the session is gone.
  await expect(tabB.getByText('The stack trace is:')).toHaveCount(0);
  await expect(
    tabB.locator('.pf-v5-c-alert, #pf-login-username-id').first(),
  ).toBeVisible();

  await tabB.reload();
  await expect(tabB.locator('#pf-login-username-id')).toBeVisible();
});
