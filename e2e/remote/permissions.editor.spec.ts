import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { ACTION_PERMISSIONS } from '../../src/utilities/action-permissions';
import { account } from '../support/accounts';
import { apiContext } from '../support/api';
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

async function getJson<T>(path: string): Promise<T> {
  const response = await api.get(path);
  expect(response.ok(), `GET ${path}`).toBe(true);
  return (await response.json()) as T;
}

async function rolePermissions(role: string): Promise<Set<string>> {
  const { results } = await getJson<{ results: { permissions: string[] }[] }>(
    `/pulp/api/v3/roles/?name=${encodeURIComponent(role)}`,
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
  const found: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await getJson<{
      results: { name: string; pulp_href: string }[];
      next: string | null;
    }>(
      `/pulp/api/v3/repositories/rpm/rpm/?limit=100&offset=${offset}&fields=name,pulp_href`,
    );
    const assignments = await Promise.all(
      page.results.map(async ({ name, pulp_href }) => {
        const { roles } = await getJson<{
          roles: { role: string; users: string[] }[];
        }>(`${pulp_href}list_roles/`);
        return roles.some(
          ({ role, users }) => role === RPM_ROLE && users.includes(editor),
        )
          ? name
          : null;
      }),
    );
    found.push(...assignments.filter((name): name is string => !!name));
    if (!page.next) {
      break;
    }
  }
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
async function openRepositoryList(page: Page, plugin: Plugin): Promise<void> {
  const permissionsRead = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/pulp\/api\/v3\/users\/[^/]+\/roles\/$/.test(
        new URL(response.url()).pathname,
      ),
  );
  await page.goto(`${plugin}/repositories`);
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

test('file repositories offer the actions the group role allows', async ({
  page,
}) => {
  const expected = allowedRowActions('file', filePermissions);
  expect(expected, 'the group role grants at least one action').not.toEqual([]);

  await openRepositoryList(page, 'file');

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const shown = Math.min(await rows.count(), 3);
  for (let index = 0; index < shown; index += 1) {
    expect(
      await offeredActions(rows.nth(index), page),
      `actions of file repository row ${index + 1}`,
    ).toEqual(expected);
  }

  await expect(addRepository(page)).toHaveCount(
    filePermissions.has(ACTION_PERMISSIONS.file.repository.add) ? 1 : 0,
  );
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

test('rpm repositories offer actions on the owned repository only', async ({
  page,
}) => {
  const expected = allowedRowActions('rpm', owned.permissions);
  expect(expected, 'the object role grants at least one action').not.toEqual(
    [],
  );

  await openRepositoryList(page, 'rpm');

  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  let ownedRows = 0;
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const name = (await row.locator('td').first().innerText()).trim();
    const toggles = await row.locator('[data-cy=kebab-toggle]').count();
    if (name === owned.name) {
      ownedRows += 1;
      expect(toggles, `actions menu of the owned repository`).toBe(1);
      expect(await offeredActions(row, page)).toEqual(expected);
    } else {
      expect(toggles, `actions menu of a repository that is not owned`).toBe(0);
    }
  }
  expect(ownedRows, 'the owned repository is listed').toBe(1);

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
  const permissionsRead = page.waitForResponse((response) =>
    /\/pulp\/api\/v3\/users\/[^/]+\/roles\/$/.test(
      new URL(response.url()).pathname,
    ),
  );
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
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});
