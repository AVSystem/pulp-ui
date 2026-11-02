import { expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// Reverting from the versions tab makes a new latest version with the content
// of the chosen one and deletes nothing. The repository is made through the
// API with two uploads, so version 1 holds one unit and version 2 holds two.

const REPOSITORIES = 'repositories/file/file/';

let objects: TestObjects;
let repository: PulpObject;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('revert');
  repository = await objects.create(REPOSITORIES, {
    name: objects.name('versions'),
  });
  await objects.upload(repository.pulp_href, 'first.txt', 'first');
  await objects.upload(repository.pulp_href, 'second.txt', 'second');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

// The number of content units a repository version holds.
async function contentCount(versionHref: string): Promise<number> {
  const version = await objects.get(versionHref);
  const present = (
    version['content_summary'] as {
      present: Record<string, { count: number }>;
    }
  ).present;
  return Object.values(present).reduce((sum, { count }) => sum + count, 0);
}

test('reverting to version 1 from the versions tab adds a version 3 with the content of version 1', async ({
  page,
}) => {
  const name = repository.name as string;
  const href = repository.pulp_href;
  expect(await contentCount(`${href}versions/1/`), 'version 1').toBe(1);
  expect(await contentCount(`${href}versions/2/`), 'version 2').toBe(2);

  await page.goto(`file/repositories/detail/${name}?tab=repository-versions`);
  await expect(title(page, name)).toBeVisible();

  const row = page.getByRole('row').filter({
    has: page.getByRole('link', { name: '1', exact: true }),
  });
  await row.locator('[data-cy=kebab-toggle] button').click();
  await page.getByRole('menuitem', { name: 'Revert to this version' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Revert repository');
  await dialog.getByRole('button', { name: 'Revert', exact: true }).click();

  await expect(
    page.getByText(`Reverted repository "${name}" to version "1".`),
  ).toBeVisible();

  // the page reloads and shows the new latest version
  await expect(
    page.getByRole('row').filter({
      has: page.getByRole('link', { name: '3', exact: true }),
    }),
  ).toContainText('(latest)');

  const latest = await objects.get(href);
  expect(latest['latest_version_href']).toBe(`${href}versions/3/`);
  expect(await contentCount(`${href}versions/3/`), 'version 3').toBe(
    await contentCount(`${href}versions/1/`),
  );
  // nothing was deleted
  expect(await contentCount(`${href}versions/2/`), 'version 2').toBe(2);
});
