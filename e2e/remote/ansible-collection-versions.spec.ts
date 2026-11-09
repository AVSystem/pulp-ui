import { type Page, expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';
import { failureShown, watchPage } from './list-pages';

// The Collection versions tab of an ansible repository and its Add collection
// dialog work on a plain Pulp server: an empty repository shows the empty state
// and no error, the dialog lists the collection versions the server holds,
// adding one puts it in the repository and removing it empties the tab again.
// The repository is made through the API; the collection version is one the
// server already holds, which the test never changes.

const COLLECTION_VERSIONS = 'content/ansible/collection_versions/';
const REPOSITORIES = 'repositories/ansible/ansible/';
const EMPTY_STATE = 'No collection versions yet';

let objects: TestObjects;
let repository: PulpObject;
// A collection version of the server, or undefined when it holds none.
let collection:
  { namespace: string; name: string; version: string } | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('collection-versions');
  repository = await objects.create(REPOSITORIES, {
    name: objects.name('repo'),
  });

  const versions = (await objects.list(COLLECTION_VERSIONS, {
    fields: 'namespace,name,version',
  })) as unknown as { namespace: string; name: string; version: string }[];
  const perCollection = new Map<string, number>();
  for (const { namespace, name } of versions) {
    const key = `${namespace}.${name}`;
    perCollection.set(key, (perCollection.get(key) ?? 0) + 1);
  }
  // a collection with few versions keeps the chosen row on the dialog's
  // first page once the list is filtered by its namespace and name
  collection = versions.find(
    ({ namespace, name }) =>
      (perCollection.get(`${namespace}.${name}`) ?? 0) <= 10,
  );
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

function tabUrl(): string {
  return `ansible/repositories/detail/${repository.name as string}?tab=collection-versions`;
}

function label(): string {
  const { namespace, name, version } = collection as NonNullable<
    typeof collection
  >;
  return `${namespace}.${name} v${version}`;
}

// The version of the repository the server reports as the latest, by number.
async function latestVersion(): Promise<number> {
  const current = await objects.get(repository.pulp_href);
  return Number(
    String(current['latest_version_href']).replace(/\/$/, '').split('/').pop(),
  );
}

async function openAddDialog(page: Page) {
  await page.getByRole('button', { name: 'Add collection' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Select a collection');
  return dialog;
}

test('an empty repository shows the empty state, and the Add collection dialog lists the collection versions of the server', async ({
  page,
}) => {
  const watch = watchPage(page);

  await page.goto(tabUrl());
  await expect(title(page, repository.name as string)).toBeVisible();
  await expect(page.getByText(EMPTY_STATE)).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(failureShown(page)).toHaveCount(0);
  await expect(page.getByText('The stack trace is:')).toHaveCount(0);
  expect(watch.failed, 'API requests of the tab that failed').toEqual([]);

  const dialog = await openAddDialog(page);
  await page.waitForLoadState('networkidle');
  if (collection) {
    await expect(dialog.getByRole('checkbox').first()).toBeVisible();
  } else {
    await expect(dialog.getByText(EMPTY_STATE)).toBeVisible();
  }
  await expect(failureShown(page)).toHaveCount(0);
  await expect(page.getByText('The stack trace is:')).toHaveCount(0);
  expect(watch.errors, 'uncaught errors of the page').toEqual([]);
  expect(watch.failed, 'API requests of the dialog that failed').toEqual([]);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('adding a collection version shows it in the tab and removing it empties the tab again', async ({
  page,
}) => {
  test.skip(!collection, 'the server holds no collection version');
  test.setTimeout(180_000);
  const { namespace, name } = collection as NonNullable<typeof collection>;
  const watch = watchPage(page);

  await page.goto(tabUrl());
  await expect(page.getByText(EMPTY_STATE)).toBeVisible();

  const dialog = await openAddDialog(page);
  await dialog.getByRole('textbox', { name: 'namespace' }).fill(namespace);
  await dialog.getByRole('textbox', { name: 'namespace' }).press('Enter');
  await dialog.getByRole('button', { name: /Namespace/ }).click();
  await page.getByRole('menuitem', { name: 'Name', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'name' }).fill(name);
  await dialog.getByRole('textbox', { name: 'name' }).press('Enter');

  const row = dialog.getByRole('row').filter({ hasText: label() });
  await expect(row).toBeVisible();
  await row.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();

  await expect(
    page.getByText(`Started adding ${label()} to repository`),
  ).toBeVisible();
  await expect.poll(latestVersion, { timeout: 60_000 }).toBe(1);

  // the tab follows the task and lists the new version without a page load
  const added = page.getByRole('row').filter({ hasText: label() });
  await expect(added).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(EMPTY_STATE)).toHaveCount(0);

  await added.locator('[data-cy=kebab-toggle] button').click();
  await page.getByRole('menuitem', { name: 'Remove', exact: true }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('Remove collection version?');
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click();

  await expect(
    page.getByText(`Removal of ${label()} from repository`),
  ).toBeVisible();
  await expect.poll(latestVersion, { timeout: 60_000 }).toBe(2);

  await expect(page.getByText(EMPTY_STATE)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole('row').filter({ hasText: label() })).toHaveCount(
    0,
  );

  await expect(page.getByText('The stack trace is:')).toHaveCount(0);
  expect(watch.errors, 'uncaught errors of the page').toEqual([]);
  expect(watch.failed, 'API requests of the tab that failed').toEqual([]);
});
