import { type Page, expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';
import { installedPlugins } from './list-pages';

// The download policy of a remote: one created from the form without touching
// the policy is stored as on demand, and the form offers the policy select for
// the plugins whose remotes have one.

const REMOTES = 'remotes/file/file/';

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('policy');
});

test.afterAll(async () => {
  await objects.cleanUp();
});

test('a file remote created without touching the policy is stored as on demand', async ({
  page,
}) => {
  const name = objects.name('default');
  await page.goto('file/remotes/edit/_');
  await page.locator('#name').fill(name);
  await page.locator('#url').fill('https://pulp.example/files/');
  await expect(page.locator('#policy')).toHaveValue('on_demand');

  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/remotes\/detail\//);
  await expect(title(page, name)).toBeVisible();

  const [created] = await objects.list(REMOTES, {
    name,
    fields: 'pulp_href,name,policy',
  });
  expect(created, 'the remote exists').toBeDefined();
  objects.track((created as PulpObject).pulp_href);
  expect(created?.['policy']).toBe('on_demand');
});

async function openAddForm(page: Page, plugin: string): Promise<void> {
  await page.goto(`${plugin}/remotes/edit/_`);
  await expect(page.locator('#name')).toBeVisible();
}

for (const plugin of ['deb', 'rpm', 'python']) {
  test(`the ${plugin} remote form offers the download policy`, async ({
    page,
  }) => {
    test.skip(
      !(await installedPlugins()).has(plugin),
      `the ${plugin} plugin is not installed on this server`,
    );
    await openAddForm(page, plugin);
    await expect(page.locator('#policy')).toBeVisible();
  });
}

test('the ansible remote form has no download policy', async ({ page }) => {
  test.skip(
    !(await installedPlugins()).has('ansible'),
    'the ansible plugin is not installed on this server',
  );
  await openAddForm(page, 'ansible');
  await expect(page.locator('#policy')).toHaveCount(0);
});
