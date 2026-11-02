import { expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// Deleting a repository removes every distribution that serves it: one bound to
// the repository, one bound to a publication of it and one that a content guard
// protects. The dialog names all three, marks the guarded one and asks for the
// repository name before it deletes anything.

const REPOSITORIES = 'repositories/file/file/';
const DISTRIBUTIONS = 'distributions/file/file/';

let objects: TestObjects;
let repository: PulpObject;
const distributionNames = {
  repository: '',
  publication: '',
  guard: '',
};

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('delete');
  repository = await objects.create(REPOSITORIES, {
    name: objects.name('doomed'),
  });
  const publication = await objects.create('publications/file/file/', {
    repository: repository.pulp_href,
  });
  const guard = await objects.create('contentguards/core/rbac/', {
    name: objects.name('guard'),
  });

  distributionNames.repository = objects.name('by-repository');
  distributionNames.publication = objects.name('by-publication');
  distributionNames.guard = objects.name('with-guard');

  await objects.create(DISTRIBUTIONS, {
    name: distributionNames.repository,
    base_path: distributionNames.repository,
    repository: repository.pulp_href,
  });
  await objects.create(DISTRIBUTIONS, {
    name: distributionNames.publication,
    base_path: distributionNames.publication,
    publication: publication.pulp_href,
  });
  await objects.create(DISTRIBUTIONS, {
    name: distributionNames.guard,
    base_path: distributionNames.guard,
    repository: repository.pulp_href,
    content_guard: guard.pulp_href,
  });
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

test('deleting a repository after typing its name removes every distribution that serves it', async ({
  page,
}) => {
  const name = repository.name as string;
  await page.goto(`file/repositories/detail/${name}`);
  await expect(title(page, name)).toBeVisible();

  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete repository?');

  const item = (distribution: string) =>
    dialog.getByRole('listitem').filter({ hasText: distribution });
  for (const distribution of Object.values(distributionNames)) {
    await expect(item(distribution), distribution).toHaveCount(1);
  }
  const guarded = /Protected by a content guard/;
  await expect(item(distributionNames.guard)).toContainText(guarded);
  await expect(item(distributionNames.repository)).not.toContainText(guarded);
  await expect(item(distributionNames.publication)).not.toContainText(guarded);

  // nothing is deleted until the repository name is typed
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.locator('#delete-repository-name').fill(`${name}x`);
  await expect(confirm).toBeDisabled();
  await dialog.locator('#delete-repository-name').fill(name);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();

  await expect
    .poll(
      async () =>
        (
          await objects.list(DISTRIBUTIONS, {
            name__startswith: objects.prefix,
            fields: 'pulp_href',
          })
        ).length,
      { message: 'distributions left after the delete', timeout: 60_000 },
    )
    .toBe(0);
  expect(
    await objects.list(REPOSITORIES, { name, fields: 'pulp_href' }),
    'the repository after the delete',
  ).toHaveLength(0);
});
