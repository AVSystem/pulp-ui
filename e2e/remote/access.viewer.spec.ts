import { type Page, expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { title } from '../support/sign-in';
import { signedOut } from './session-helpers';

// What the limited account is shown of the administration screens, and what a
// visitor who is not signed in is shown at all. These are presentation rules:
// Pulp decides who may read what, and the screens only stop offering what the
// server would refuse.

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });

// The administration screens by address: the lists and the forms that create.
const ADMINISTRATION = [
  'users',
  'groups',
  'roles',
  'users/create',
  'roles/create',
];

test.describe('the limited account', () => {
  test('has no Users, Groups or Roles entry in the sidebar', async ({
    page,
  }) => {
    await page.goto('status');
    await expect(title(page, 'Status')).toBeVisible();
    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-status]'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    for (const id of ['users', 'groups', 'roles']) {
      await expect(
        sidebar(page).locator(`[data-cy=pulp-menu-item-${id}]`),
      ).toHaveCount(0);
    }
    await expect(
      sidebar(page).getByRole('link', { name: /^(Users|Groups|Roles)$/ }),
    ).toHaveCount(0);
  });

  for (const path of ADMINISTRATION) {
    test(`${path} opened by address shows the insufficient permissions page`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(title(page, 'Insufficient permissions')).toBeVisible();
      await expect(
        page.getByText('You do not have permission to view this page.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
      await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    });
  }

  test('opens its own profile and sees it', async ({ page }) => {
    await page.goto('users/profile');

    await expect(title(page, 'My profile')).toBeVisible();
    // the profile shows the account's own record, read-only, with its user name
    await expect(
      page.getByRole('main').getByText(account('viewer').username),
    ).toBeVisible();
    await expect(title(page, 'Insufficient permissions')).toHaveCount(0);
    // the profile of an account that may not change users offers no Edit,
    // checked once the requests of the page have settled
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0);
  });
});

test.describe('a visitor who is not signed in', () => {
  test.use({ storageState: signedOut });

  test('sees only Login in the sidebar and the Status screen without versions', async ({
    page,
  }) => {
    await page.goto('status');

    await expect(title(page, 'Status')).toBeVisible();
    await expect(
      page.getByText(
        'Versions, workers and storage are shown to signed-in users.',
      ),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    const links = sidebar(page).getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-login]'),
    ).toBeVisible();
    await expect(page.getByText('Versions', { exact: true })).toHaveCount(0);
  });
});
