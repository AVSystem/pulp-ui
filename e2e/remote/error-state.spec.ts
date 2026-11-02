import { type Page, expect, test } from '@playwright/test';
import { TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// A list or detail page whose requests fail shows the error state with a Retry
// button, never the error boundary, and Retry loads the page once the server
// can be reached again. The requests are cut off in the browser, so nothing on
// the server is touched.

const REPOSITORIES = 'repositories/file/file/';
const REPOSITORY_REQUESTS = /\/pulp\/api\/v3\/repositories\/file\/file\//;

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('error-state');
});

test.afterAll(async () => {
  await objects.cleanUp();
});

async function cutOffRepositories(page: Page): Promise<void> {
  await page.route(REPOSITORY_REQUESTS, (route) => route.abort('failed'));
}

async function expectNoBoundary(page: Page): Promise<void> {
  await expect(page.getByText('The stack trace is:')).toHaveCount(0);
}

test('a repository list whose requests are aborted shows the error state and Retry shows the rows again', async ({
  page,
}) => {
  const repository = await objects.create(REPOSITORIES, {
    name: objects.name('list'),
  });
  const name = repository.name as string;

  // the filter keeps the row on the first page whatever else the server holds
  await page.goto(`file/repositories?name__icontains=${name}`);
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();

  await cutOffRepositories(page);
  await page.reload();

  await expect(
    page.getByText('Repositories could not be displayed.'),
  ).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await expect(page.getByRole('link', { name, exact: true })).toHaveCount(0);
  await expectNoBoundary(page);

  await page.unroute(REPOSITORY_REQUESTS);
  await retry.click();

  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(
    page.getByText('Repositories could not be displayed.'),
  ).toHaveCount(0);
  await expectNoBoundary(page);
});

test('a repository page whose requests are aborted shows the error state and Retry shows the repository again', async ({
  page,
}) => {
  const repository = await objects.create(REPOSITORIES, {
    name: objects.name('detail'),
  });
  const name = repository.name as string;

  await page.goto(`file/repositories/detail/${name}`);
  await expect(title(page, name)).toBeVisible();

  await cutOffRepositories(page);
  await page.reload();

  await expect(
    page.getByText('Repository could not be displayed.'),
  ).toBeVisible();
  const retry = page.getByRole('button', { name: 'Retry' });
  await expect(retry).toBeVisible();
  await expectNoBoundary(page);

  await page.unroute(REPOSITORY_REQUESTS);
  await retry.click();

  await expect(title(page, name)).toBeVisible();
  await expect(
    page.getByText('Repository could not be displayed.'),
  ).toHaveCount(0);
  await expectNoBoundary(page);
});
