import { type Page, expect, test } from '@playwright/test';
import { getGroupsListUrl } from '@pulp-ui/sdk/core/groups';
import { getGroupsRolesListUrl } from '@pulp-ui/sdk/core/groups-roles';
import { getGroupsUsersListUrl } from '@pulp-ui/sdk/core/groups-users';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import { getUsersListUrl } from '@pulp-ui/sdk/core/users';
import { randomBytes } from 'node:crypto';
import { TestObjects } from '../support/api';
import { apiCall, apiGet } from '../support/sdk-request';
import { title } from '../support/sign-in';

// The screens that administer accounts, used the way an administrator uses
// them against a real server: the status page, and users, groups (members and
// roles) and roles created, changed and deleted through their forms and
// dialogs. Every change is read back from the server, and every object carries
// the run's prefix so clean-up finds it.

const USERS = getUsersListUrl();
const GROUPS = getGroupsListUrl();
const ROLES = getRolesListUrl();

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('screens');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

// A password for a test account, different on every run and never written
// anywhere.
function newPassword(): string {
  return `Pw-${randomBytes(12).toString('hex')}`;
}

// The row actions of a list row open from its menu.
async function openRowAction(
  page: Page,
  rowSelector: string,
  action: 'Edit' | 'Delete',
): Promise<void> {
  const row = page.locator(rowSelector);
  await expect(row).toBeVisible();
  await row.locator('[data-cy=kebab-toggle] button').click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
}

// The one object of an endpoint with this exact name or user name.
async function only(path: string, filter: Record<string, string>) {
  const found = await objects.list(path, filter);
  expect(found, `${path} matching ${JSON.stringify(filter)}`).toHaveLength(1);
  return found[0]!;
}

test.describe('Status', () => {
  test('shows the versions, the online workers, the storage and the content settings to an administrator', async ({
    page,
  }) => {
    await page.goto('status');
    await expect(title(page, 'Status')).toBeVisible();

    const main = page.getByRole('main');
    for (const card of [
      'Versions',
      'Online workers',
      'Storage',
      'Content settings',
    ]) {
      await expect(main.getByText(card, { exact: true }), card).toBeVisible();
    }
    // an administrator's answer holds everything, so no note says it is cut
    await expect(
      page.getByText(
        'Workers, storage and content settings are shown to administrators.',
      ),
    ).toHaveCount(0);
  });
});

test.describe('users', () => {
  test('a user is created from the form, edited from the list and deleted', async ({
    page,
  }) => {
    const name = objects.name('user');
    const password = newPassword();

    // create
    await page.goto('users/create');
    await expect(title(page, 'Create new user')).toBeVisible();
    await page.locator('#username').fill(name);
    await page.locator('#first_name').fill('Before');
    await page.locator('#password').fill(password);
    await page.locator('#password-confirm').fill(password);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/users\/?$/);

    const created = await only(USERS, { username: name });
    objects.track(created.pulp_href);
    expect(created['first_name'], 'the first name as created').toBe('Before');

    // edit from the row
    const row = `[data-cy="UserList-row-${name}"]`;
    await page.goto(`users?username__contains=${encodeURIComponent(name)}`);
    await expect(title(page, 'Users')).toBeVisible();
    await openRowAction(page, row, 'Edit');
    await expect(page).toHaveURL(/\/users\/edit\//);
    await expect(page.locator('#first_name')).toHaveValue('Before');
    await page.locator('#first_name').fill('After');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/users\/?$/);

    const edited = await objects.get(created.pulp_href);
    expect(edited['first_name'], 'the first name after the edit').toBe('After');
    expect(edited['username'], 'the user name is kept').toBe(name);

    // delete from the row
    await page.goto(`users?username__contains=${encodeURIComponent(name)}`);
    await openRowAction(page, row, 'Delete');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete user?');
    await expect(dialog).toContainText(name);
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText(`User "${name}" has been successfully deleted.`),
    ).toBeVisible();

    const gone = await apiCall(objects.api, 'GET', created.pulp_href, {
      accept: [404],
    });
    expect(gone.status, 'a read of the deleted user').toBe(404);
  });
});

test.describe('groups', () => {
  test('a group is created, gets a member and a role, loses the role and is deleted', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const member = await objects.create(USERS, {
      username: objects.name('member'),
      password: newPassword(),
    });
    const memberName = member['username'] as string;
    const role = await objects.create(ROLES, {
      name: objects.name('grouprole'),
      permissions: ['file.view_filerepository'],
    });
    const roleName = role.name as string;
    const groupName = objects.name('group');

    // create from the list: the new group opens on its roles tab
    await page.goto('groups');
    await expect(title(page, 'Groups')).toBeVisible();
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    const createDialog = page.getByRole('dialog');
    await createDialog.locator('#group_name').fill(groupName);
    await createDialog
      .getByRole('button', { name: 'Create', exact: true })
      .click();
    await expect(page).toHaveURL(/\/groups\/detail\//);
    await expect(title(page, groupName)).toBeVisible();

    const group = await only(GROUPS, { name: groupName });
    objects.track(group.pulp_href);
    const tabs = page.locator('.pulp-tab-link-container');

    // add the member; the dialog never offers a user who already is one
    await tabs.getByRole('link', { name: 'Users', exact: true }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const addDialog = page.getByRole('dialog');
    const search = addDialog.getByRole('combobox', { name: 'Select users' });
    await search.fill(memberName);
    await addDialog.getByRole('option', { name: memberName }).click();
    await addDialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(
      page.getByText(
        `User "${memberName}" has been successfully added to group "${groupName}".`,
      ),
    ).toBeVisible();
    await expect(
      page.locator(`[data-cy="GroupDetail-users-${memberName}"]`),
    ).toBeVisible();

    const members = await apiGet<{ results: { username: string }[] }>(
      objects.api,
      getGroupsUsersListUrl(group.pulp_href),
    );
    expect(members.results.map(({ username }) => username)).toEqual([
      memberName,
    ]);

    await page.getByRole('button', { name: 'Add', exact: true }).click();
    const again = page.getByRole('dialog');
    await again
      .getByRole('combobox', { name: 'Select users' })
      .fill(memberName);
    await expect(
      again.getByRole('option', { name: memberName }),
      'the member in the add dialog',
    ).toHaveCount(0);
    await again.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // add the role through the wizard
    await tabs.getByRole('link', { name: 'Access', exact: true }).click();
    await page.getByRole('button', { name: 'Add roles' }).click();
    const wizard = page.getByRole('dialog');
    await wizard
      .getByRole('textbox', { name: 'name__icontains' })
      .fill(roleName);
    await wizard
      .getByRole('textbox', { name: 'name__icontains' })
      .press('Enter');
    const pick = wizard.locator(
      `[data-cy="RoleListTable-CheckboxRow-row-${roleName}"]`,
    );
    await expect(pick).toBeVisible();
    await pick.getByRole('checkbox').check();
    await wizard.getByRole('button', { name: 'Next' }).click();
    await wizard.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(
      page.getByText(
        `Role ${roleName} has been successfully added to ${groupName}.`,
      ),
    ).toBeVisible();
    const roleRow = `[data-cy="RoleListTable-ExpandableRow-row-${roleName}"]`;
    await expect(page.locator(roleRow)).toBeVisible();

    const assigned = await apiGet<{ results: { role: string }[] }>(
      objects.api,
      getGroupsRolesListUrl(group.pulp_href),
    );
    expect(assigned.results.map((entry) => entry.role)).toEqual([roleName]);

    // remove the role
    await page
      .locator(roleRow)
      .locator('[data-cy=kebab-toggle] button')
      .click();
    await page.getByRole('menuitem', { name: 'Remove role' }).click();
    const removeDialog = page.getByRole('dialog');
    await expect(removeDialog).toContainText(roleName);
    await removeDialog
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(
      page.getByText(`Role "${roleName}" has been successfully removed.`),
    ).toBeVisible();
    const left = await apiGet<{ results: { role: string }[] }>(
      objects.api,
      getGroupsRolesListUrl(group.pulp_href),
    );
    expect(left.results, 'roles left on the group').toHaveLength(0);

    // delete the group from its page
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const deleteDialog = page.getByRole('dialog');
    await expect(deleteDialog).toContainText('Delete group?');
    await expect(deleteDialog).toContainText(memberName);
    await deleteDialog
      .getByRole('button', { name: 'Delete', exact: true })
      .click();
    await expect(page).toHaveURL(/\/groups\/?$/);
    await expect(
      page.getByText(`Group "${groupName}" has been successfully deleted.`),
    ).toBeVisible();

    const gone = await apiCall(objects.api, 'GET', group.pulp_href, {
      accept: [404],
    });
    expect(gone.status, 'a read of the deleted group').toBe(404);
  });
});

test.describe('roles', () => {
  test('a role is created from the form, edited from the list and deleted', async ({
    page,
  }) => {
    const name = objects.name('role');

    await page.goto('roles/create');
    await expect(title(page, 'Create a new role')).toBeVisible();
    await page.locator('#role_name').fill(name);
    await page.locator('#role_description').fill('before the edit');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/roles\/?$/);

    const created = await only(ROLES, { name });
    objects.track(created.pulp_href);
    expect(created['description'], 'the description as created').toBe(
      'before the edit',
    );

    const row = `[data-cy="RoleListTable-ExpandableRow-row-${name}"]`;
    await page.goto(`roles?name__icontains=${encodeURIComponent(name)}`);
    await expect(title(page, 'Roles')).toBeVisible();
    await openRowAction(page, row, 'Edit');
    await expect(page).toHaveURL(/\/roles\/edit\//);
    await expect(page.locator('#role_description')).toHaveValue(
      'before the edit',
    );
    await page.locator('#role_description').fill('after the edit');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page).toHaveURL(/\/roles\/?$/);

    const edited = await objects.get(created.pulp_href);
    expect(edited['description'], 'the description after the edit').toBe(
      'after the edit',
    );
    expect(edited['name'], 'the name is kept').toBe(name);

    await page.goto(`roles?name__icontains=${encodeURIComponent(name)}`);
    await openRowAction(page, row, 'Delete');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete role?');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText(`Role "${name}" has been successfully deleted.`),
    ).toBeVisible();

    const gone = await apiCall(objects.api, 'GET', created.pulp_href, {
      accept: [404],
    });
    expect(gone.status, 'a read of the deleted role').toBe(404);
  });
});
