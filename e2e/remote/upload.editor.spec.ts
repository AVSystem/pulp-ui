import { type APIRequestContext, expect, test } from '@playwright/test';
import { getUsersListUrl } from '@pulp-ui/sdk/core/users';
import { getPublicationsFileFileListUrl } from '@pulp-ui/sdk/file/publications-file';
import {
  getRepositoriesFileFileAddRoleUrl,
  getRepositoriesFileFileListUrl,
  getRepositoriesFileFileRemoveRoleUrl,
} from '@pulp-ui/sdk/file/repositories-file';
import { randomBytes } from 'node:crypto';
import { account } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
import { PLUGINS } from '../support/distribution-screens';
import { apiPost } from '../support/sdk-request';
import { submitLoginForm, title } from '../support/sign-in';
import {
  MiB,
  chooseFiles,
  fileRow,
  openUploadDialog,
  recordRequests,
  versionPaths,
} from '../support/upload-screens';

// Uploading files as the editor, who may modify the repositories of the run
// through a role the administrator gives on each repository and this spec
// removes, and who may not create uploads or manage the repository as a whole.
// Several files make one version each, the dialog says so, a repository that
// keeps few versions is called out, and a file above the chunk threshold is
// sent in one request with a note about it.

const OWNER = 'file.filerepository_owner';

let objects: TestObjects;
let admin: APIRequestContext;
const granted: string[] = [];

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  admin = (objects = await TestObjects.open('editup')).api;
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  // the grants first, so nothing the editor may reach is left if the clean-up
  // of the objects fails
  for (const href of granted) {
    await apiPost(admin, getRepositoriesFileFileRemoveRoleUrl(href), {
      role: OWNER,
      users: [account('editor').username],
    });
  }
  granted.length = 0;
  await objects?.cleanUp({ fileContent: true });
});

// A repository of the run that the editor may modify.
async function editable(
  suffix: string,
  extra: Record<string, unknown> = {},
): Promise<PulpObject> {
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name(suffix),
    ...extra,
  });
  await apiPost(
    admin,
    getRepositoriesFileFileAddRoleUrl(repository.pulp_href),
    {
      role: OWNER,
      users: [account('editor').username],
    },
  );
  granted.push(repository.pulp_href);
  return repository;
}

const small = (name: string) => ({
  name,
  buffer: Buffer.from(`${objects.prefix}${name}\n`),
  path: objects.path(name),
});

test('two files make one version each, and the dialog says so beforehand', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const repository = await editable('each');
  const files = [small('e1.txt'), small('e2.txt')];

  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, files);
  await expect(
    dialog.getByText('Each file creates its own repository version'),
  ).toBeVisible();
  await expect(
    dialog.getByText(
      'Adding several files as one version needs an administrator.',
    ),
  ).toBeVisible();
  await expect(
    dialog.getByText('All files are added in one new repository version'),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByText('2 files added')).toBeVisible({
    timeout: 120_000,
  });
  for (const { name } of files) {
    await expect(fileRow(dialog, name)).toContainText('Added');
  }
  await dialog.getByRole('button', { name: 'Done' }).click();

  // one version for each file
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([2, 1, 0]);
  expect(
    await versionPaths(objects, `${repository.pulp_href}versions/2/`),
  ).toEqual(files.map(({ path }) => path).sort());
});

test('a repository that keeps few versions carries a warning for the editor', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const repository = await editable('retain', { retain_repo_versions: 2 });
  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, [small('k1.txt')]);
  await expect(dialog.getByText('Older versions may be removed')).toBeVisible();
  await expect(
    dialog.getByText(/keeps only its latest 2 versions/),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a file above the chunk threshold is sent in one request with a note, because uploads are not allowed', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const repository = await editable('large');
  const requests = recordRequests(page);
  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, [
    {
      name: 'large.bin',
      buffer: randomBytes(9 * MiB),
      path: objects.path('large.bin'),
    },
  ]);
  await expect(
    dialog.getByText('Large files are sent in one request and may time out'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(fileRow(dialog, 'large.bin')).toContainText('Added', {
    timeout: 240_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  expect(
    requests.filter((line) => line.includes('/pulp/api/v3/uploads/')),
    'requests to the uploads endpoint',
  ).toEqual([]);
  expect(
    requests.filter((line) =>
      line.startsWith('POST /pulp/api/v3/content/file/files/'),
    ),
    'content create requests',
  ).toHaveLength(1);
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([1, 0]);
});

test('the editor deletes the newest published version of a repository a distribution serves, and the server answers in the dialog', async ({
  page,
}) => {
  test.setTimeout(240_000);
  // version 1 holds one file and version 2 two; version 2 is published and a
  // repository-bound distribution serves it
  const repository = await objects.fileRepository('served', [
    'p1.txt',
    'p2.txt',
  ]);
  await apiPost(
    admin,
    getRepositoriesFileFileAddRoleUrl(repository.pulp_href),
    {
      role: OWNER,
      users: [account('editor').username],
    },
  );
  granted.push(repository.pulp_href);
  await objects.create(getPublicationsFileFileListUrl(), {
    repository_version: `${repository.pulp_href}versions/2/`,
  });
  const name = objects.name('served-dist');
  await objects.create(PLUGINS.file.distributions, {
    name,
    base_path: name,
    repository: repository.pulp_href,
  });

  await page.goto(
    `file/repositories/${encodeURIComponent(repository['name'] as string)}/versions`,
  );
  const table = page.getByRole('grid', { name: 'Repository versions' });
  const two = table.locator('tbody tr').filter({
    has: page.getByRole('link', { name: '2', exact: true }),
  });
  await two.locator('[data-cy=kebab-toggle] button').click();
  // the editor may not read publications, so nothing says this version is
  // served and the item is offered
  const item = page.getByRole('menuitem', { name: /Delete version/ });
  await expect(item).not.toHaveAttribute('aria-disabled', 'true');
  await item.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  // the server refuses and the dialog shows what it said, staying open
  await expect(dialog).toContainText('The version could not be deleted.');
  await expect(dialog).toContainText(
    /currently being used to distribute content/,
  );
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([2, 1, 0]);
});

// The interface takes the staff flag of a user's record for the superuser flag,
// which the server does not expose to a signed-in user. An account that is staff
// without being a superuser is therefore offered the one-version flow, and the
// server refuses each file because it may not make content that belongs to no
// repository. The refusal is shown per file and nothing is added.
test('an account that is staff but not a superuser is offered the one-version flow and the server refuses each file', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('staff'),
  });
  const username = objects.name('staff-user');
  const password = randomBytes(12).toString('hex');
  await objects.create(getUsersListUrl(), {
    username,
    password,
    is_staff: true,
  });
  await apiPost(
    admin,
    getRepositoriesFileFileAddRoleUrl(repository.pulp_href),
    {
      role: OWNER,
      users: [username],
    },
  );

  // a session of its own: the project's saved session is the editor's
  const context = await browser.newContext({
    baseURL: process.env['PULP_UI_E2E_BASE_URL'],
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await page.goto('login');
    await submitLoginForm(page, username, password);
    await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible({
      timeout: 60_000,
    });
    const dialog = await openUploadDialog(page, repository['name'] as string);
    await chooseFiles(dialog, [small('s1.txt'), small('s2.txt')]);
    await expect(
      dialog.getByText('All files are added in one new repository version'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText('0 of 2 files added')).toBeVisible({
      timeout: 120_000,
    });
    for (const name of ['s1.txt', 's2.txt']) {
      const row = fileRow(dialog, name);
      await expect(row).toContainText('Failed');
      await expect(row).toContainText(
        'Destination upload repository was not provided.',
      );
    }
  } finally {
    await context.close();
  }
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([0]);
});

// The distribution list reads its rows' columns in batches, never one object at
// a time, for an account that is not an administrator and holds roles on single
// repositories. The count is that of one load of the default page, from the
// click on the sidebar entry to every column settled.
test('one load of the distribution list stays within the request budget of a page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('status');
  await expect(title(page, 'Status')).toBeVisible();
  const requests = recordRequests(page);
  await page.locator('[data-cy=pulp-menu-item-distributions]').click();
  await expect(
    page.locator(
      'table[aria-label="Distributions"][data-rows-loaded="true"][data-columns-loaded="true"]',
    ),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  test.info().annotations.push({
    type: 'requests',
    description: `${requests.length}`,
  });
  expect(
    requests.filter((line) => line.includes('my_permissions')),
    'requests to my_permissions',
  ).toEqual([]);
  expect(
    requests.length,
    'API requests of one load of the page',
  ).toBeLessThanOrEqual(16);
});
