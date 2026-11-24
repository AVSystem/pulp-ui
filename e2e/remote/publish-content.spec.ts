import { type Locator, type Page, expect, test } from '@playwright/test';
import { getPublicationsFileFileListUrl } from '@pulp-ui/sdk/file/publications-file';
import { type PulpObject, TestObjects } from '../support/api';
import { PLUGINS } from '../support/distribution-screens';
import { apiCall, apiGet } from '../support/sdk-request';
import { title } from '../support/sign-in';

// Publishing, publications, repository versions and their content on a real
// server, through the screens, with run-scoped file repositories that the
// administrator sets up through the API. The server is asked after each change
// and the content app is asked what a distribution serves, so a screen and
// what clients get cannot disagree unnoticed.

const PUBLICATIONS = getPublicationsFileFileListUrl();
const DISTRIBUTIONS = PLUGINS.file.distributions;
const enc = encodeURIComponent;

let objects: TestObjects;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  objects = await TestObjects.open('publish');
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  await objects?.cleanUp({ fileContent: true });
});

const repositoryAddress = (name: string, tab = '') =>
  `file/repositories/${enc(name)}${tab ? `/${tab}` : ''}`;

const versionHref = (repository: PulpObject, number: number) =>
  `${repository.pulp_href}versions/${number}/`;

// A distribution made through the API: public, so the content app answers
// without credentials.
function distribute(
  suffix: string,
  binding: { publication: string } | { repository: string },
): Promise<PulpObject> {
  const name = objects.name(suffix);
  return objects.create(DISTRIBUTIONS, { name, base_path: name, ...binding });
}

// The status the content app answers for a file of a distribution.
async function served(
  distribution: PulpObject,
  relativePath: string,
): Promise<number> {
  const base = (await objects.get(distribution.pulp_href))['base_url'];
  const answer = await objects.api.get(`${String(base)}${relativePath}`, {
    failOnStatusCode: false,
  });
  return answer.status();
}

// Waits until the content app answers a status for a file of a distribution.
async function expectServed(
  distribution: PulpObject,
  relativePath: string,
  status: number,
): Promise<void> {
  await expect
    .poll(() => served(distribution, relativePath), {
      message: `status of ${String(distribution.name)}/${relativePath}`,
      timeout: 60_000,
    })
    .toBe(status);
}

// The version number a publication was made from.
async function publishedVersion(href: string): Promise<number> {
  const publication = await objects.get(href);
  const match = /\/versions\/(\d+)\/$/.exec(
    String(publication['repository_version']),
  );
  return Number(match?.[1]);
}

const grid = (scope: Page | Locator, name: string | RegExp): Locator =>
  scope.getByRole('grid', { name });

const bodyRows = (table: Locator): Locator => table.locator('tbody tr');

// The row of a table that holds a link or text.
const rowWith = (table: Locator, text: string | RegExp): Locator =>
  bodyRows(table).filter({ hasText: text });

const kebab = (row: Locator): Locator =>
  row.locator('[data-cy=kebab-toggle] button');

test.describe('publish', () => {
  let main: PulpObject;
  let pinned: PulpObject;
  let follower: PulpObject;
  let first: PulpObject;

  test.beforeAll(async () => {
    test.setTimeout(240_000);
    // version 1 holds a, version 2 holds a and b
    main = await objects.fileRepository('main', ['a.txt', 'b.txt']);
    first = await objects.create(PUBLICATIONS, {
      repository_version: versionHref(main, 1),
    });
    pinned = await distribute('pinned', { publication: first.pulp_href });
    follower = await distribute('follower', { repository: main.pulp_href });
  });

  test('publishing the latest version moves the ticked pinned distribution and only that one', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const name = main['name'] as string;
    // before: the pinned distribution serves version 1, which has no b
    await expectServed(pinned, objects.path('a.txt'), 200);
    expect(await served(pinned, objects.path('b.txt'))).toBe(404);

    await page.goto(repositoryAddress(name));
    await expect(title(page, name)).toBeVisible();
    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    const dialog = page.locator('[data-cy=PublishDialog]');
    await expect(dialog).toContainText(`Publish repository "${name}"`);
    // only a distribution bound to an older publication is offered, unticked
    const box = dialog.getByRole('checkbox', {
      name: pinned['name'] as string,
    });
    await expect(box).toBeVisible();
    await expect(box).not.toBeChecked();
    await expect(
      dialog.getByRole('checkbox', { name: follower['name'] as string }),
    ).toHaveCount(0);
    await box.check();
    await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

    // the dialog waits for the task, then moves the ticked distribution
    await expect(dialog).toContainText(
      /1 distributions now serve the new publication\./,
      { timeout: 120_000 },
    );
    await expect(
      dialog.getByRole('list', { name: 'Result of each move' }),
    ).toContainText(pinned['name'] as string);
    await dialog
      .getByRole('contentinfo')
      .getByRole('button', { name: 'Close' })
      .click();
    await expect(dialog).toHaveCount(0);

    // the repository's progress panel found the publish task
    await expect(page.locator('[data-cy=SyncProgress]')).toContainText(
      /Publish/,
    );

    // the server: a second publication exists and the distribution serves it
    const publications = await objects.list(PUBLICATIONS, {
      repository: main.pulp_href,
      fields: 'pulp_href,repository_version',
    });
    expect(publications, 'publications of the repository').toHaveLength(2);
    const bound = (await objects.get(pinned.pulp_href))['publication'];
    expect(bound, 'the distribution is bound to a new publication').not.toBe(
      first.pulp_href,
    );
    expect(await publishedVersion(String(bound))).toBe(2);

    // the content app agrees: the pinned and the repository-bound
    // distribution both serve b now
    await expectServed(pinned, objects.path('b.txt'), 200);
    await expectServed(follower, objects.path('b.txt'), 200);
  });

  test('the Publications tab lists both publications and the delete confirmation names what changes', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = main['name'] as string;
    await page.goto(repositoryAddress(name, 'publications'));
    const table = grid(page, 'Publications');
    await expect(bodyRows(table)).toHaveCount(2);

    // the newer one is served by both distributions
    const newer = rowWith(table, pinned['name'] as string);
    await expect(newer).toContainText(follower['name'] as string);
    // the older one by none
    const older = bodyRows(table).filter({
      hasNotText: pinned['name'] as string,
    });
    await expect(older).toContainText('None');

    // deleting the older one names nothing: no distribution serves it
    await kebab(older).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete publication?');
    await expect(dialog).toContainText(
      'No distribution serves this publication.',
    );
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText('Publication of version 1 deleted'),
    ).toBeVisible();
    await expect(bodyRows(table)).toHaveCount(1);
    expect(
      await objects.list(PUBLICATIONS, {
        repository: main.pulp_href,
        fields: 'pulp_href',
      }),
    ).toHaveLength(1);

    // the one that is left is served by both: the confirmation names them and
    // says each will serve nothing; it is cancelled
    await kebab(bodyRows(table).first()).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const last = page.getByRole('dialog');
    await expect(last).toContainText('Delete publication?');
    for (const distribution of [pinned, follower]) {
      await expect(last).toContainText(distribution['name'] as string);
    }
    await expect(last.getByText('will serve nothing (404)')).toHaveCount(2);
    await last.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(
      await objects.list(PUBLICATIONS, {
        repository: main.pulp_href,
        fields: 'pulp_href',
      }),
      'the cancelled delete removed nothing',
    ).toHaveLength(1);
  });

  test('a version lists its content and what it added and removed, and the counts agree with the summary', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const name = main['name'] as string;
    const a = objects.path('a.txt');
    const b = objects.path('b.txt');

    // version 2: both files present, b added, nothing removed
    await page.goto(`${repositoryAddress(name, 'versions')}/2`);
    const summary = grid(page, 'Content summary');
    // present, added and removed of version 2
    await expect(rowWith(summary, 'Files').locator('td')).toHaveText([
      'Files',
      '2',
      '1',
      '0',
    ]);
    const present = grid(page, 'Files present');
    await expect(bodyRows(present)).toHaveCount(2);
    await expect(present).toContainText(a);
    await expect(present).toContainText(b);
    const added = grid(page, 'Files added');
    await expect(bodyRows(added)).toHaveCount(1);
    await expect(added).toContainText(b);
    await expect(page.getByText('Nothing was removed.')).toBeVisible();

    // version 1: only a, all of it added
    await page.goto(`${repositoryAddress(name, 'versions')}/1`);
    await expect(
      rowWith(grid(page, 'Content summary'), 'Files').locator('td'),
    ).toHaveText(['Files', '1', '1', '0']);
    await expect(bodyRows(grid(page, 'Files present'))).toHaveCount(1);

    // version 0 holds nothing
    await page.goto(`${repositoryAddress(name, 'versions')}/0`);
    await expect(
      page.getByText('This version holds no content.'),
    ).toBeVisible();
  });

  test('a version a distribution serves is protected with its reason, and an unused one is deleted', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const name = main['name'] as string;
    await page.goto(repositoryAddress(name, 'versions'));
    const table = grid(page, 'Repository versions');
    await expect(bodyRows(table)).toHaveCount(3);

    // version 2: bound to by a publication a distribution is pinned to, and the
    // newest published version a repository-bound distribution serves
    const two = bodyRows(table).filter({
      has: page.getByRole('link', { name: '2', exact: true }),
    });
    await kebab(two).click();
    const protectedItem = page.getByRole('menuitem', {
      name: /Delete version/,
    });
    await expect(protectedItem).toHaveAttribute('aria-disabled', 'true');
    await expect(protectedItem).toContainText(pinned['name'] as string);
    await expect(protectedItem).toContainText(follower['name'] as string);
    await page.keyboard.press('Escape');

    // the version's own page says the same
    await page.goto(`${repositoryAddress(name, 'versions')}/2`);
    const button = page.getByRole('button', { name: 'Delete version' });
    await expect(button).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('[data-cy=VersionDetail]')).toContainText(
      pinned['name'] as string,
    );

    // version 1 is served by nothing now: its publication is gone
    await page.goto(repositoryAddress(name, 'versions'));
    const one = bodyRows(grid(page, 'Repository versions')).filter({
      has: page.getByRole('link', { name: '1', exact: true }),
    });
    await kebab(one).click();
    const item = page.getByRole('menuitem', { name: /Delete version/ });
    await expect(item).not.toHaveAttribute('aria-disabled', 'true');
    await item.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Delete repository version?');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText(`Deletion of version 1 of ${name} finished.`),
    ).toBeVisible({ timeout: 120_000 });
    await expect(
      bodyRows(grid(page, 'Repository versions')).filter({
        has: page.getByRole('link', { name: '1', exact: true }),
      }),
    ).toHaveCount(0);
    expect(await objects.versionNumbers(main.pulp_href)).toEqual([2, 0]);
  });
});

test.describe('a publication that a repository-bound distribution serves', () => {
  test('the delete confirmation says which version it falls back to, and the content app does that', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // version 1 holds x, version 2 holds x and y; both are published
    const repository = await objects.fileRepository('fallback', [
      'x.txt',
      'y.txt',
    ]);
    const older = await objects.create(PUBLICATIONS, {
      repository_version: versionHref(repository, 1),
    });
    const newer = await objects.create(PUBLICATIONS, {
      repository_version: versionHref(repository, 2),
    });
    const follower = await distribute('fallback-dist', {
      repository: repository.pulp_href,
    });
    await expectServed(follower, objects.path('y.txt'), 200);

    const name = repository['name'] as string;
    await page.goto(repositoryAddress(name, 'publications'));
    const table = grid(page, 'Publications');
    await expect(bodyRows(table)).toHaveCount(2);
    // the row of version 2: its link carries the number
    const two = bodyRows(table).filter({
      has: page.getByRole('link', { name: '2', exact: true }),
    });
    await kebab(two).click();
    await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(follower['name'] as string);
    await expect(dialog).toContainText('will serve version 1');
    await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(
      page.getByText('Publication of version 2 deleted'),
    ).toBeVisible();

    // what the content app answers is what the dialog said: version 1
    await expectServed(follower, objects.path('x.txt'), 200);
    await expectServed(follower, objects.path('y.txt'), 404);
    expect(await objects.get(newer.pulp_href).catch(() => null)).toBeNull();
    expect((await objects.get(older.pulp_href))['pulp_href']).toBe(
      older.pulp_href,
    );
  });
});

test.describe('content', () => {
  test('removing three files makes one new version, and earlier versions still list them', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const repository = await objects.fileRepository('remove', [
      'f1.txt',
      'f2.txt',
      'f3.txt',
      'f4.txt',
    ]);
    const name = repository['name'] as string;
    await page.goto(repositoryAddress(name, 'content'));
    const table = grid(page, 'Files');
    await expect(bodyRows(table)).toHaveCount(4);
    for (const file of ['f1.txt', 'f2.txt', 'f3.txt']) {
      await page
        .getByRole('checkbox', { name: `Select ${objects.path(file)}` })
        .check();
    }
    await expect(page.getByText('3 rows selected')).toBeVisible();
    await page.getByRole('button', { name: 'Remove from repository' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Remove content');
    await dialog.getByRole('button', { name: 'Remove', exact: true }).click();

    // one new version, version 5; the list shows the one file left
    await expect
      .poll(() => objects.versionNumbers(repository.pulp_href), {
        message: 'versions after the removal',
        timeout: 120_000,
      })
      .toEqual([5, 4, 3, 2, 1, 0]);
    // the list reads the new version when the task has ended
    await expect(bodyRows(grid(page, 'Files'))).toHaveCount(1, {
      timeout: 60_000,
    });
    await expect(grid(page, 'Files')).toContainText(objects.path('f4.txt'));

    // the version before the removal still lists all four
    await page.goto(`${repositoryAddress(name, 'versions')}/4`);
    await expect(bodyRows(grid(page, 'Files present'))).toHaveCount(4);
  });

  test('a label set on a unit shows on the same unit in another repository, and is removed again', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const one = await objects.fileRepository('labels-one', ['l.txt']);
    const two = await objects.fileRepository('labels-two', ['l.txt']);
    const path = objects.path('l.txt');
    const key = 'zz-e2e-label';

    await page.goto(repositoryAddress(one['name'] as string, 'content'));
    await page.getByRole('button', { name: `Edit labels of ${path}` }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(`Labels of ${path}`);
    await dialog.getByLabel('Label key').fill(key);
    await dialog.getByLabel('Label value').fill('shown');
    await dialog.getByRole('button', { name: 'Add label' }).click();
    await expect(dialog.getByText(`${key}: shown`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(grid(page, 'Files')).toContainText(`${key}: shown`);

    // the same unit in the other repository carries it
    await page.goto(repositoryAddress(two['name'] as string, 'content'));
    await expect(grid(page, 'Files')).toContainText(`${key}: shown`);

    // and it is removed again, from the second repository's screen
    await page.getByRole('button', { name: `Edit labels of ${path}` }).click();
    const editor = page.getByRole('dialog');
    await editor.getByRole('button', { name: `Remove label ${key}` }).click();
    await expect(editor.getByText(`${key}: shown`)).toHaveCount(0);
    await editor.getByRole('button', { name: 'Done' }).click();
    await page.goto(repositoryAddress(one['name'] as string, 'content'));
    await expect(grid(page, 'Files')).not.toContainText(key);
  });

  test('content is added from another repository: one new version that holds both, and an older source version is chosen by its number', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    // the source holds s1 in version 1 and s1, s2 in version 2
    const source = await objects.fileRepository('source', ['s1.txt', 's2.txt']);
    const target = await objects.fileRepository('target', ['t1.txt']);
    const targetName = target['name'] as string;

    await page.goto(repositoryAddress(targetName, 'content'));
    await page
      .getByRole('button', { name: 'Add content', exact: true })
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('Add content');
    const box = dialog.getByRole('combobox', { name: 'Select a repository' });
    await box.click();
    await box.fill(source['name'] as string);
    await dialog
      .getByRole('option', { name: source['name'] as string })
      .first()
      .click();

    // the latest version of the source is the default
    await expect(dialog.getByLabel('Version')).toHaveValue('2');
    const sourceRows = bodyRows(grid(dialog, 'Files'));
    await expect(sourceRows).toHaveCount(2);

    // an older version by its number lists only what it held
    await dialog.getByLabel('Version').fill('1');
    await expect(sourceRows).toHaveCount(1);
    await expect(grid(dialog, 'Files')).toContainText(objects.path('s1.txt'));
    await dialog.getByLabel('Version').fill('2');
    await expect(sourceRows).toHaveCount(2);

    // tick both and add: exactly one new version of the target
    await dialog
      .getByRole('checkbox', { name: 'Select all on this page' })
      .check();
    await dialog.getByRole('button', { name: 'Add 2 items' }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(() => objects.versionNumbers(target.pulp_href), {
        message: 'versions of the target after the addition',
        timeout: 120_000,
      })
      .toEqual([2, 1, 0]);
    await expect(bodyRows(grid(page, 'Files'))).toHaveCount(3, {
      timeout: 60_000,
    });
    for (const file of ['t1.txt', 's1.txt', 's2.txt']) {
      await expect(grid(page, 'Files')).toContainText(objects.path(file));
    }
  });

  test('the only version of a repository cannot be deleted, and the server refuses it too', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const scratch = await objects.create(PLUGINS.file.repositories, {
      name: objects.name('scratch'),
    });
    const name = scratch['name'] as string;
    await page.goto(repositoryAddress(name, 'versions'));
    const table = grid(page, 'Repository versions');
    await expect(bodyRows(table)).toHaveCount(1);
    await kebab(bodyRows(table).first()).click();
    const item = page.getByRole('menuitem', { name: /Delete version/ });
    await expect(item).toHaveAttribute('aria-disabled', 'true');
    await expect(item).toContainText('The only version of the repository.');

    // what the server does when asked anyway: it takes the request as a task
    // and the task fails, so the version stays
    const answer = await apiCall<{ task: string }>(
      objects.api,
      'DELETE',
      versionHref(scratch, 0),
    );
    expect(answer.status).toBe(202);
    const outcome = await objects
      .waitForTask(answer.body.task)
      .then(() => 'completed')
      .catch((error: Error) => error.message);
    test.info().annotations.push({ type: 'server', description: outcome });
    expect(outcome, 'the task that deletes the only version').not.toBe(
      'completed',
    );
    expect(await objects.versionNumbers(scratch.pulp_href)).toEqual([0]);
    expect(await apiGet(objects.api, scratch.pulp_href)).toBeTruthy();
  });
});
