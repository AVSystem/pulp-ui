import { expect, request, test } from '@playwright/test';
import { getOrphansCleanupCleanupUrl } from '@pulp-ui/sdk/core/orphans-cleanup';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account, origin } from '../support/env';
import { apiPost } from '../support/sdk-request';
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

  // A task has its own address, /tasks/<id>, and the address that links used
  // before it ends on the new one. The task is an orphan cleanup the run starts
  // itself with the throwaway Pulp's administrator; with the default
  // protection time it removes nothing.
  test('a task opens from the list at its own address and the old address ends on it', async ({
    page,
  }) => {
    const { username, password } = account();
    const api = await request.newContext({
      baseURL: origin(),
      extraHTTPHeaders: {
        Authorization: basicAuthorization(username, password),
      },
    });
    let taskId: string;
    try {
      const started = await apiPost<{ task: string }>(
        api,
        getOrphansCleanupCleanupUrl(),
        { orphan_protection_time: 1440 },
      );
      taskId = started.task.split('/').filter(Boolean).pop() as string;
    } finally {
      await api.dispose();
    }

    await page.goto('tasks?page_size=100');
    await expect(title(page, 'Task management')).toBeVisible();
    await page.locator(`a[href$="/tasks/${taskId}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/ui/tasks/${taskId}$`));
    await expect(title(page, 'Task detail')).toBeVisible();

    await page.goto(`tasks/detail/${taskId}`);
    await expect(page).toHaveURL(new RegExp(`/ui/tasks/${taskId}$`));
    await expect(title(page, 'Task detail')).toBeVisible();
  });

  // The old address of a task that does not exist ends on the new address,
  // which says the page is not there.
  test('the old address of an unknown task ends on the new address and shows the 404 page', async ({
    page,
  }) => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await page.goto(`tasks/detail/${unknown}`);
    await expect(page).toHaveURL(new RegExp(`/ui/tasks/${unknown}$`));
    await expect(title(page, '404 - Page not found')).toBeVisible();
  });

  // A screen that needs an API this UI does not use yet says so instead of
  // failing.
  test('Search shows the placeholder', async ({ page }) => {
    await page.goto('search');
    await expect(title(page, 'Search')).toBeVisible();
    await expect(
      page.getByText('This screen is not available in this UI yet.'),
    ).toBeVisible();
  });

  // Workflows of the galaxy_ng server have no screen here, so their addresses
  // lead to the page for unknown routes.
  test('a removed galaxy workflow shows the 404 page', async ({ page }) => {
    await page.goto('ansible/approvals');
    await expect(title(page, '404 - Page not found')).toBeVisible();
  });

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
