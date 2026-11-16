import { expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { title } from '../support/sign-in';

// An administrator may change their own record, so the profile offers Edit
// (the limited accounts' specs check that theirs does not).

test('the administrator opens their own profile and is offered Edit', async ({
  page,
}) => {
  await page.goto('users/profile');

  await expect(title(page, 'My profile')).toBeVisible();
  await expect(
    page.getByRole('main').getByText(account('admin').username),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toBeVisible();
});
