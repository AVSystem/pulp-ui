import { expect, test } from '@playwright/test';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import { TestObjects } from '../support/api';
import { apiCall } from '../support/sdk-request';
import { title } from '../support/sign-in';

// The row actions of the role list against a real server: a custom role is
// edited and then deleted from its row, and each change is read back from the
// server. Built-in roles are not touched.

const ROLES = getRolesListUrl();

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('roles');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

test('a custom role is edited and deleted from the role list', async ({
  page,
}) => {
  const permissions = ['file.view_filerepository'];
  const role = await objects.create(ROLES, {
    name: objects.name('custom'),
    description: 'before the edit',
    permissions,
  });
  const name = role.name as string;
  const row = () =>
    page.locator(`[data-cy="RoleListTable-ExpandableRow-row-${name}"]`);
  const openRowAction = async (action: 'Edit' | 'Delete') => {
    await page.goto(`roles?name__icontains=${name}`);
    await expect(title(page, 'Roles')).toBeVisible();
    await expect(row()).toBeVisible();
    await row().locator('[data-cy=kebab-toggle] button').click();
    await page.getByRole('menuitem', { name: action, exact: true }).click();
  };

  await openRowAction('Edit');
  await expect(page).toHaveURL(/\/roles\/edit\//);
  const description = page.locator('#role_description');
  await expect(description).toHaveValue('before the edit');
  await description.fill('after the edit');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      new URL(response.url()).pathname === role.pulp_href,
  );
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await saved).status(), 'the answer to the save').toBe(200);
  await expect(page).toHaveURL(/\/roles\/?$/);

  const edited = await objects.get(role.pulp_href);
  expect(edited['description']).toBe('after the edit');
  expect(edited['permissions']).toEqual(permissions);

  await openRowAction('Delete');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText(name)).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(/has been successfully deleted/)).toBeVisible();

  const gone = await apiCall(objects.api, 'GET', role.pulp_href, {
    accept: [404],
  });
  expect(gone.status, 'a read of the deleted role').toBe(404);
});
