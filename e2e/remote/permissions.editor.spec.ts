import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import { getRemotesFileFileListUrl } from '@pulp-ui/sdk/file/remotes-file';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import {
  getRepositoriesRpmRpmListRolesUrl,
  getRepositoriesRpmRpmListUrl,
} from '@pulp-ui/sdk/rpm/repositories-rpm';
import { ACTION_PERMISSIONS } from '../../src/utilities/action-permissions';
import { account } from '../support/accounts';
import { apiContext, listAll } from '../support/api';
import { apiGet } from '../support/sdk-request';
import { isPermissionsRead } from '../support/session';
import { title } from '../support/sign-in';

// What an account that is neither administrator nor read-only is shown. The
// editor account holds one role of its own (it may add Python repositories),
// one role through a group (it owns every file repository) and one role on a
// single rpm repository (it owns that one). Nothing is hard-coded here: the
// permissions of the three roles and the repository the editor owns are read
// from the server with the administrator, and every page is checked against
// what they say. The screens only hide actions the server would refuse; the
// server still decides each request. This spec writes nothing.

const FILE_ROLE = 'file.filerepository_owner';
const PYTHON_ROLE = 'python.pythonrepository_creator';
const RPM_ROLE = 'rpm.rpmrepository_owner';

const ROW_ACTIONS = [
  { title: 'Edit', key: 'change' },
  { title: 'Sync', key: 'sync' },
  { title: 'Delete', key: 'delete' },
] as const;

type Plugin = 'file' | 'python' | 'rpm' | 'deb';

let api: APIRequestContext;
let filePermissions: Set<string>;
let pythonPermissions: Set<string>;
let owned: { name: string; permissions: Set<string> };

async function rolePermissions(role: string): Promise<Set<string>> {
  const { results } = await apiGet<{ results: { permissions: string[] }[] }>(
    api,
    getRolesListUrl(),
    { name: role },
  );
  expect(results, `the role ${role} exists on the server`).toHaveLength(1);
  return new Set(results[0]?.permissions);
}

// The rpm repository the editor holds the owner role on, and the permissions
// that role gives on it, read from the role assignments of each repository.
async function ownedRpmRepository(
  editor: string,
  permissions: Set<string>,
): Promise<{ name: string; permissions: Set<string> }> {
  const repositories = await listAll(api, getRepositoriesRpmRpmListUrl(), {
    fields: 'name,pulp_href',
  });
  const assignments = await Promise.all(
    repositories.map(async ({ name, pulp_href }) => {
      const { roles } = await apiGet<{
        roles: { role: string; users: string[] }[];
      }>(api, getRepositoriesRpmRpmListRolesUrl(pulp_href));
      return roles.some(
        ({ role, users }) => role === RPM_ROLE && users.includes(editor),
      )
        ? name
        : null;
    }),
  );
  const found = assignments.filter((name): name is string => !!name);
  expect(
    found,
    'rpm repositories the editor holds the owner role on',
  ).toHaveLength(1);
  return { name: found[0] as string, permissions };
}

test.beforeAll(async () => {
  api = await apiContext();
  filePermissions = await rolePermissions(FILE_ROLE);
  pythonPermissions = await rolePermissions(PYTHON_ROLE);
  owned = await ownedRpmRepository(
    account('editor').username,
    await rolePermissions(RPM_ROLE),
  );
});

test.afterAll(async () => {
  await api.dispose();
});

// The titles of the row actions a set of permissions allows on a plugin's
// repositories, in the order the list offers them.
function allowedRowActions(plugin: Plugin, held: Set<string>): string[] {
  return ROW_ACTIONS.filter(({ key }) =>
    held.has(ACTION_PERMISSIONS[plugin].repository[key]),
  ).map(({ title: action }) => action);
}

// Opens a repository list once the application has read the account's
// permissions, so that an action missing from the page is missing because of
// them and not because they were still being read.
async function openRepositoryList(
  page: Page,
  plugin: Plugin,
  query = '',
): Promise<void> {
  const permissionsRead = page.waitForResponse(isPermissionsRead);
  await page.goto(`${plugin}/repositories${query}`);
  await permissionsRead;
  await expect(title(page, 'Repositories')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

const addRepository = (page: Page) =>
  page.getByRole('button', { name: 'Add repository', exact: true });

const rowActionToggles = (page: Page) => page.locator('[data-cy=kebab-toggle]');

// Opens the actions menu of a row and returns the actions it offers.
async function offeredActions(row: Locator, page: Page): Promise<string[]> {
  await row.locator('[data-cy=kebab-toggle] button').click();
  const items = page.getByRole('menuitem');
  await expect(items.first()).toBeVisible();
  const names = (await items.allInnerTexts()).map(
    (text) => text.split('\n')[0]?.trim() ?? '',
  );
  await page.keyboard.press('Escape');
  await expect(items.first()).toBeHidden();
  return names;
}

const FILE_ROW_ORDER = ['Sync', 'Edit', 'Delete'];

// Sync needs a remote to sync from, so the list offers it on the rows that have
// one and leaves it out of the others.
async function expectedFileActions(names: string[]): Promise<string[][]> {
  const { results } = await apiGet<{
    results: { name: string; remote: string | null }[];
  }>(api, getRepositoriesFileFileListUrl(), {
    name__in: names.join(','),
    limit: String(Math.max(names.length, 1)),
    fields: 'name,remote',
  });
  // the order the framework list offers the actions in
  const allowed = FILE_ROW_ORDER.filter((action) =>
    allowedRowActions('file', filePermissions).includes(action),
  );
  return names.map((name) => {
    const row = results.find((found) => found.name === name);
    expect(row, `file repository ${name} exists on the server`).toBeDefined();
    return row?.remote
      ? allowed
      : allowed.filter((action) => action !== 'Sync');
  });
}

test('file repositories offer the actions the group role allows, Sync only where there is a remote', async ({
  page,
}) => {
  expect(
    allowedRowActions('file', filePermissions),
    'the group role grants at least one action',
  ).not.toEqual([]);

  await openRepositoryList(page, 'file');

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const shown = Math.min(await rows.count(), 3);
  const names = await Promise.all(
    Array.from({ length: shown }, async (_, index) =>
      (await rows.nth(index).locator('td a').first().innerText()).trim(),
    ),
  );
  const expected = await expectedFileActions(names);
  for (let index = 0; index < shown; index += 1) {
    expect(
      await offeredActions(rows.nth(index), page),
      `actions of file repository row ${index + 1}`,
    ).toEqual(expected[index]);
  }

  await expect(addRepository(page)).toHaveCount(
    filePermissions.has(ACTION_PERMISSIONS.file.repository.add) ? 1 : 0,
  );
});

test('a file repository with a remote offers Sync to the editor', async ({
  page,
}) => {
  // the seeded repository of one of the remotes made for the sync checks
  const { results } = await apiGet<{ results: { name: string }[] }>(
    api,
    getRemotesFileFileListUrl(),
    { name__startswith: 'zz-synth-file-', name__endswith: '-src', limit: '1' },
  );
  const remote = results[0]?.name ?? '';
  expect(remote, 'a seeded file remote').not.toBe('');
  const name = remote.slice(0, -'-src'.length);
  const [expected] = await expectedFileActions([name]);
  expect(
    expected,
    'Sync is among the actions of a repository with a remote',
  ).toContain('Sync');

  await openRepositoryList(
    page,
    'file',
    `?name__icontains=${encodeURIComponent(name)}`,
  );
  const row = page.locator('tbody tr', { hasText: name }).first();
  await expect(row).toBeVisible();
  expect(await offeredActions(row, page)).toEqual(expected);
});

test('python repositories offer Add repository and no row action', async ({
  page,
}) => {
  expect(
    pythonPermissions.has(ACTION_PERMISSIONS.python.repository.add),
    'the account role allows adding Python repositories',
  ).toBe(true);
  expect(
    allowedRowActions('python', pythonPermissions),
    'the account role allows no Python row action',
  ).toEqual([]);

  await openRepositoryList(page, 'python');

  await expect(addRepository(page)).toBeVisible();
  await expect(rowActionToggles(page)).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /^(Edit|Sync|Delete)/ }),
  ).toHaveCount(0);
});

// The rows of the open list by repository name and whether each draws an
// actions menu.
async function rowsWithMenus(
  page: Page,
): Promise<{ name: string; toggles: number }[]> {
  const rows = page.locator('tbody tr');
  // a list the account may not read in part can be empty
  await expect(
    rows.first().or(page.getByText('No results found')),
  ).toBeVisible();
  const count = await rows.count();
  const found: { name: string; toggles: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    found.push({
      name: (await row.locator('td').first().innerText()).trim(),
      toggles: await row.locator('[data-cy=kebab-toggle]').count(),
    });
  }
  return found;
}

test('rpm repositories offer actions on the owned repository only', async ({
  page,
}) => {
  const expected = allowedRowActions('rpm', owned.permissions);
  expect(expected, 'the object role grants at least one action').not.toEqual(
    [],
  );

  // The list is filtered by name so that the result does not depend on how
  // many repositories the server holds or on the order and size of its pages.
  await openRepositoryList(
    page,
    'rpm',
    `?name__icontains=${encodeURIComponent(owned.name)}`,
  );
  const ownedRows = (await rowsWithMenus(page)).filter(
    ({ name }) => name === owned.name,
  );
  expect(ownedRows, 'the owned repository is listed once').toHaveLength(1);
  expect(ownedRows[0]?.toggles, 'actions menu of the owned repository').toBe(1);
  expect(
    await offeredActions(
      page.locator('tbody tr', { hasText: owned.name }).first(),
      page,
    ),
  ).toEqual(expected);
  await expect(addRepository(page)).toHaveCount(0);

  // A second filtered view of a repository that exists but is not owned: the
  // server lists only what the account may read, and no row that is listed
  // draws a menu.
  const others = (
    await apiGet<{ results: { name: string }[] }>(
      api,
      getRepositoriesRpmRpmListUrl(),
      { limit: '20', fields: 'name' },
    )
  ).results
    .map(({ name }) => name)
    .filter((name) => !name.includes(owned.name) && !owned.name.includes(name));
  expect(others, 'rpm repositories that are not owned').not.toEqual([]);
  await openRepositoryList(
    page,
    'rpm',
    `?name__icontains=${encodeURIComponent(others[0] as string)}`,
  );
  for (const { name, toggles } of await rowsWithMenus(page)) {
    expect(
      toggles,
      `actions menu of ${name}, a repository that is not owned`,
    ).toBe(0);
  }
  await expect(addRepository(page)).toHaveCount(0);
});

test('deb repositories offer no action', async ({ page }) => {
  await openRepositoryList(page, 'deb');

  await expect(addRepository(page)).toHaveCount(0);
  await expect(rowActionToggles(page)).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /^(Edit|Sync|Delete)/ }),
  ).toHaveCount(0);
});

test('the sidebar has no Users, Groups or Roles entry', async ({ page }) => {
  const permissionsRead = page.waitForResponse(isPermissionsRead);
  await page.goto('status');
  await permissionsRead;
  await expect(title(page, 'Status')).toBeVisible();
  await page.waitForLoadState('networkidle');

  const sidebar = page.getByRole('navigation', { name: 'Main' });
  await expect(
    sidebar.locator('[data-cy=pulp-menu-item-status]'),
  ).toBeVisible();
  for (const id of ['users', 'groups', 'roles']) {
    await expect(sidebar.locator(`[data-cy=pulp-menu-item-${id}]`)).toHaveCount(
      0,
    );
  }
  await expect(
    sidebar.getByRole('link', { name: /^(Users|Groups|Roles)$/ }),
  ).toHaveCount(0);
});

test('the editor opens its own profile and sees it', async ({ page }) => {
  await page.goto('users/profile');

  await expect(title(page, 'My profile')).toBeVisible();
  await expect(
    page.getByRole('main').getByText(account('editor').username),
  ).toBeVisible();
  await expect(title(page, 'Insufficient permissions')).toHaveCount(0);
  // the profile of an account that may not change users offers no Edit,
  // checked once the requests of the page have settled
  await page.waitForLoadState('networkidle');
  await expect(
    page.getByRole('button', { name: 'Edit', exact: true }),
  ).toHaveCount(0);
});
