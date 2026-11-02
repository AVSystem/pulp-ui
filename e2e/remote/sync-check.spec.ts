import { expect, test } from '@playwright/test';
import { TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// The sync dialog asks the server whether a task already holds the repository
// before it offers Sync. The question must be one the server accepts and
// answers: a refused question would leave the check silently without a result.

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('syncchk');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

test('opening the sync dialog asks the server for running tasks of the repository and leaves Sync usable when none runs', async ({
  page,
}) => {
  // the address is reserved for examples and is never contacted: nothing is
  // synced in this test
  const remote = await objects.create('remotes/file/file/', {
    name: objects.name('remote'),
    url: 'https://pulp.example/zz-e2e/PULP_MANIFEST',
  });
  const repository = await objects.create('repositories/file/file/', {
    name: objects.name('repo'),
    remote: remote.pulp_href,
  });
  const name = repository.name as string;

  await page.goto(`file/repositories/detail/${name}`);
  await expect(title(page, name)).toBeVisible();

  const question = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/pulp/api/v3/tasks/' &&
      url.searchParams.has('exclusive_resources') &&
      url.searchParams.has('state__in')
    );
  });
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  const answer = await question;

  const asked = new URL(answer.url()).searchParams;
  expect(asked.get('exclusive_resources'), 'the repository asked about').toBe(
    repository.pulp_href,
  );
  expect(asked.get('state__in'), 'the states asked about').toBe(
    'waiting,running',
  );
  expect(answer.status(), 'the server accepts the question').toBe(200);

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Sync repository "${name}"`);
  await expect(
    dialog.getByRole('button', { name: 'Sync', exact: true }),
  ).toBeEnabled();
  await expect(dialog.getByText(/already (queued|running)/)).toHaveCount(0);
  await expect(dialog.getByText(/Could not check whether a sync/)).toHaveCount(
    0,
  );
});
