import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import {
  getDistributionsAnsibleAnsibleAddRoleUrl,
  getDistributionsAnsibleAnsibleRemoveRoleUrl,
} from '@pulp-ui/sdk/ansible/distributions-ansible';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import {
  getDistributionsPythonPypiAddRoleUrl,
  getDistributionsPythonPypiRemoveRoleUrl,
} from '@pulp-ui/sdk/python/distributions-pypi';
import { account } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
import { PLUGINS } from '../support/distribution-screens';
import { apiGet, apiPost } from '../support/sdk-request';
import { isPermissionsRead } from '../support/session';
import { title } from '../support/sign-in';

// What the editor account is shown on the list of every plugin's distributions
// when it holds a role on single distributions. The administrator makes three
// distributions of this run: the editor is given the owner role on one python
// and one ansible distribution, and the viewer role on a second python
// distribution that it may therefore read and not change. The list must offer
// Edit and Delete on the two owned rows and no action on the third, and the
// pages of the distributions must say the same. The screens only hide actions
// the server would refuse; the server still decides each request. The grants
// are removed by this spec, and the distributions with them.

const PYTHON_OWNER = 'python.pythondistribution_owner';
const PYTHON_VIEWER = 'python.pythondistribution_viewer';
const ANSIBLE_OWNER = 'ansible.ansibledistribution_owner';

let objects: TestObjects;
let api: APIRequestContext;
let owned: { python: PulpObject; ansible: PulpObject };
let viewable: PulpObject;
const granted: { href: string; role: string; remove: string }[] = [];

async function rolePermissions(role: string): Promise<Set<string>> {
  const { results } = await apiGet<{ results: { permissions: string[] }[] }>(
    api,
    getRolesListUrl(),
    { name: role },
  );
  expect(results, `the role ${role} exists on the server`).toHaveLength(1);
  return new Set(results[0]?.permissions);
}

async function grant(
  href: string,
  role: string,
  addUrl: string,
  removeUrl: string,
): Promise<void> {
  await apiPost(api, addUrl, {
    role,
    users: [account('editor').username],
  });
  granted.push({ href, role, remove: removeUrl });
}

test.beforeAll(async () => {
  test.setTimeout(180_000);
  api = (objects = await TestObjects.open('dperm')).api;
  const python = await objects.create(PLUGINS.python.distributions, {
    name: objects.name('python-owned'),
    base_path: objects.name('python-owned'),
  });
  const ansible = await objects.create(PLUGINS.ansible.distributions, {
    name: objects.name('ansible-owned'),
    base_path: objects.name('ansible-owned'),
  });
  viewable = await objects.create(PLUGINS.python.distributions, {
    name: objects.name('python-viewable'),
    base_path: objects.name('python-viewable'),
  });
  owned = { python, ansible };

  await grant(
    python.pulp_href,
    PYTHON_OWNER,
    getDistributionsPythonPypiAddRoleUrl(python.pulp_href),
    getDistributionsPythonPypiRemoveRoleUrl(python.pulp_href),
  );
  await grant(
    ansible.pulp_href,
    ANSIBLE_OWNER,
    getDistributionsAnsibleAnsibleAddRoleUrl(ansible.pulp_href),
    getDistributionsAnsibleAnsibleRemoveRoleUrl(ansible.pulp_href),
  );
  await grant(
    viewable.pulp_href,
    PYTHON_VIEWER,
    getDistributionsPythonPypiAddRoleUrl(viewable.pulp_href),
    getDistributionsPythonPypiRemoveRoleUrl(viewable.pulp_href),
  );
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  // the grants first, so nothing the editor may reach is left if the clean-up
  // of the objects fails
  for (const { remove, role } of granted) {
    await apiPost(api, remove, {
      role,
      users: [account('editor').username],
    });
  }
  granted.length = 0;
  await objects.cleanUp();
});

// Opens the list narrowed to this run's distributions once the application has
// read the account's permissions and every column has settled, so an action
// missing from a row is missing because of them and not because they were
// still being read.
async function openRunList(page: Page): Promise<void> {
  const permissionsRead = page.waitForResponse(isPermissionsRead);
  await page.goto(
    `distributions?name__icontains=${encodeURIComponent(objects.prefix)}`,
  );
  await permissionsRead;
  await expect(title(page, 'Distributions')).toBeVisible();
  await expect(
    page.locator(
      'table[aria-label="Distributions"][data-rows-loaded="true"][data-columns-loaded="true"]',
    ),
  ).toBeVisible();
}

const rowOf = (page: Page, name: string): Locator =>
  page.locator(`[data-cy="DistributionList-row-${name}"]`);

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

test('the roles the editor holds on single distributions give Edit and Delete on those rows only', async ({
  page,
}) => {
  const [pythonOwner, ansibleOwner, viewer] = await Promise.all([
    rolePermissions(PYTHON_OWNER),
    rolePermissions(ANSIBLE_OWNER),
    rolePermissions(PYTHON_VIEWER),
  ]);
  expect(
    pythonOwner.has('python.change_pythondistribution') &&
      pythonOwner.has('python.delete_pythondistribution'),
    'the python owner role changes and deletes a distribution',
  ).toBe(true);
  expect(
    ansibleOwner.has('ansible.change_ansibledistribution') &&
      ansibleOwner.has('ansible.delete_ansibledistribution'),
    'the ansible owner role changes and deletes a distribution',
  ).toBe(true);
  expect(
    viewer.has('python.change_pythondistribution') ||
      viewer.has('python.delete_pythondistribution'),
    'the python viewer role changes or deletes nothing',
  ).toBe(false);

  await openRunList(page);
  // the rows are the three of this run: an empty or short list would pass the
  // checks below without testing anything
  await expect(page.locator('tbody tr')).toHaveCount(3);

  for (const distribution of [owned.python, owned.ansible]) {
    expect(
      await offeredActions(rowOf(page, distribution.name as string), page),
      `actions of ${distribution.name}`,
    ).toEqual(['Edit', 'Delete']);
  }
  await expect(
    rowOf(page, viewable.name as string),
    'the row the editor may only read',
  ).toBeVisible();
  await expect(
    rowOf(page, viewable.name as string).locator('[data-cy=kebab-toggle]'),
    'actions menu of the distribution that is not owned',
  ).toHaveCount(0);
  await expect(
    page.getByRole('menuitem', { name: /^(Edit|Delete)/ }),
  ).toHaveCount(0);
});

test('the pages of the distributions offer Edit and Delete where the list does', async ({
  page,
}) => {
  const plugins = [
    ['python', owned.python, true],
    ['ansible', owned.ansible, true],
    ['python', viewable, false],
  ] as const;

  for (const [plugin, distribution, mayChange] of plugins) {
    const permissionsRead = page.waitForResponse(isPermissionsRead);
    await page.goto(
      `${plugin}/distributions/${encodeURIComponent(distribution.name as string)}`,
    );
    await permissionsRead;
    await expect(title(page, distribution.name as string)).toBeVisible();
    await page.waitForLoadState('networkidle');

    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    const remove = page.getByRole('button', { name: 'Delete', exact: true });
    if (mayChange) {
      await expect(edit, `Edit on ${distribution.name}`).toBeVisible();
      await expect(remove, `Delete on ${distribution.name}`).toBeVisible();
    } else {
      await expect(edit, `Edit on ${distribution.name}`).toHaveCount(0);
      await expect(remove, `Delete on ${distribution.name}`).toHaveCount(0);
    }
  }
});
