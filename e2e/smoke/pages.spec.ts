import { expect, test } from '@playwright/test';
import { signIn, title } from '../support/sign-in';

// Every list page opens with its title once signed in. A page that fails to
// render or to load its data does not show its title.
const pages: { name: string; path: string; title: string }[] = [
  {
    name: 'Ansible repositories',
    path: 'ansible/repositories',
    title: 'Repositories',
  },
  { name: 'Ansible remotes', path: 'ansible/remotes', title: 'Remotes' },
  {
    name: 'File repositories',
    path: 'file/repositories',
    title: 'Repositories',
  },
  { name: 'File remotes', path: 'file/remotes', title: 'Remotes' },
  { name: 'Task management', path: 'tasks', title: 'Task management' },
  { name: 'Users', path: 'users', title: 'Users' },
  { name: 'Groups', path: 'groups', title: 'Groups' },
  { name: 'Roles', path: 'roles', title: 'Roles' },
  { name: 'About project', path: 'about', title: 'About project' },
];

test.describe('pages of a signed-in session', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  for (const { name, path, title: heading } of pages) {
    test(name, async ({ page }) => {
      await page.goto(path);
      await expect(title(page, heading)).toBeVisible();
    });
  }

  // The throwaway Pulp starts empty, so the empty states are shown.
  test('Deb repositories', async ({ page }) => {
    await page.goto('deb/repositories');
    await expect(title(page, 'Repositories')).toBeVisible();
    await expect(page.getByText('No repositories yet')).toBeVisible();
  });

  test('Deb remotes', async ({ page }) => {
    await page.goto('deb/remotes');
    await expect(title(page, 'Remotes')).toBeVisible();
    await expect(page.getByText('No remotes yet')).toBeVisible();

    // an apt remote cannot sync without being told which suites to fetch, so
    // the form carries fields the other plugins have no use for
    await page.getByRole('button', { name: 'Add remote' }).click();
    await expect(page.locator('#distributions')).toBeVisible();
    await expect(page.locator('#components')).toBeVisible();
    await expect(page.locator('#architectures')).toBeVisible();
  });

  test('Python repositories', async ({ page }) => {
    await page.goto('python/repositories');
    await expect(title(page, 'Repositories')).toBeVisible();
    await expect(page.getByText('No repositories yet')).toBeVisible();

    // pulp_python repositories can refuse package substitution, so the form
    // carries settings the other plugins have no use for
    await page.getByRole('button', { name: 'Add repository' }).click();
    await expect(page.locator('#allow_package_substitution')).toBeVisible();
    await expect(page.locator('#error_on_reject')).toBeVisible();
  });

  test('Python remotes', async ({ page }) => {
    await page.goto('python/remotes');
    await expect(title(page, 'Remotes')).toBeVisible();
    await expect(page.getByText('No remotes yet')).toBeVisible();

    // a Python remote filters what it syncs by project, package type and
    // platform, and offers the download policy
    await page.getByRole('button', { name: 'Add remote' }).click();
    await expect(page.locator('#includes')).toBeVisible();
    await expect(page.locator('#excludes')).toBeVisible();
    await expect(page.locator('#keep_latest_packages')).toBeVisible();
    await expect(page.locator('#package_types_sdist')).toBeVisible();
    await expect(page.locator('#policy')).toHaveValue('on_demand');
  });

  test('Python packages', async ({ page }) => {
    await page.goto('python/packages');
    await expect(title(page, 'Packages')).toBeVisible();
    await expect(page.getByText('No packages yet')).toBeVisible();
  });

  test('RPM repositories', async ({ page }) => {
    await page.goto('rpm/repositories');
    await expect(title(page, 'Repositories')).toBeVisible();
    await expect(page.getByText('No repositories yet')).toBeVisible();

    // pulp_rpm repositories carry publishing and retention settings the other
    // plugins have no use for, and a new one must not publish until asked to
    await page.getByRole('button', { name: 'Add repository' }).click();
    await expect(page.locator('#autopublish')).not.toBeChecked();
    await expect(page.locator('#retain_package_versions')).toBeVisible();
  });

  test('RPM remotes', async ({ page }) => {
    await page.goto('rpm/remotes');
    await expect(title(page, 'Remotes')).toBeVisible();
    await expect(page.getByText('No remotes yet')).toBeVisible();

    // the download policy decides whether packages are fetched during sync or
    // on first request, so an RPM remote offers it in the form
    await page.getByRole('button', { name: 'Add remote' }).click();
    await expect(page.locator('#policy')).toBeVisible();
  });

  test('RPM packages', async ({ page }) => {
    await page.goto('rpm/rpms');
    await expect(title(page, 'Packages')).toBeVisible();
    await expect(page.getByText('No packages yet')).toBeVisible();
  });
});
