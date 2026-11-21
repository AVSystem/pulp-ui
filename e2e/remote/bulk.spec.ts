import { type Locator, type Page, expect, test } from '@playwright/test';
import { getDistributionsFileFileListUrl } from '@pulp-ui/sdk/file/distributions-file';
import { getRemotesFileFileListUrl } from '@pulp-ui/sdk/file/remotes-file';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { type PulpObject, TestObjects, runId } from '../support/api';
import { clickSidebar, listTable } from '../support/framework-list';
import { title } from '../support/sign-in';

// The bulk actions of the file repository list against a real server, on
// repositories this run made: labels added and removed with a per-row result,
// a sync of repositories with and without a remote, and a delete whose result
// is read in the dialog or, when the user has left the list, in the summary
// that waits on the screen they went to. The seeded lab data is not touched.

const REPOSITORIES = getRepositoriesFileFileListUrl();
const REMOTES = getRemotesFileFileListUrl();
const SYNC_TASK = 'pulp_file.app.tasks.synchronizing.synchronize';

let objects: TestObjects;
// repositories of the label and sync checks: two with a remote, one without
let withRemote: [PulpObject, PulpObject];
let withoutRemote: PulpObject;

// A label key of this run alone, so the labels of every other object stay as
// they are.
const labelKey = () => `e2e-${runId()}`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('bulk');

  const [source] = await objects.list(getDistributionsFileFileListUrl(), {
    name: 'zz-synth-sync-source',
    fields: 'base_url',
  });
  const sourceUrl = source?.['base_url'] as string;
  expect(sourceUrl, 'the URL of the seeded sync source').toMatch(
    /^https?:\/\//,
  );

  // Nothing is downloaded: the sync only records what the manifest lists. Each
  // repository has a remote of its own, because syncing the same content
  // through one remote in two repositories at once made one of the two tasks
  // fail on the server.
  withRemote = (await Promise.all(
    ['a', 'b'].map(async (suffix) => {
      const remote = await objects.create(REMOTES, {
        name: objects.name(`remote-${suffix}`),
        url: `${sourceUrl}PULP_MANIFEST`,
        policy: 'on_demand',
      });
      return objects.create(REPOSITORIES, {
        name: objects.name(suffix),
        remote: remote.pulp_href,
      });
    }),
  )) as [PulpObject, PulpObject];
  withoutRemote = await objects.create(REPOSITORIES, {
    name: objects.name('c'),
  });
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

// The list narrowed to the repositories of this run whose name starts with
// `stem`, with its rows shown.
async function openRun(page: Page, stem: string): Promise<void> {
  await page.goto(
    `file/repositories?name__icontains=${encodeURIComponent(objects.name(stem))}`,
  );
  await expect(title(page, 'Repositories')).toBeVisible();
  await expect(listTable(page, 'Repositories', { rows: true })).toBeVisible();
}

const tick = (page: Page, name: string) =>
  page.getByRole('checkbox', { name: `Select ${name}`, exact: true }).check();

async function chooseBulkAction(page: Page, action: string): Promise<Locator> {
  await page.getByRole('button', { name: 'Bulk actions' }).click();
  await page.getByRole('menuitem', { name: action, exact: true }).click();
  const dialog = page.locator('[data-cy=BulkDialog]');
  await expect(dialog).toBeVisible();
  return dialog;
}

// The button of the dialog's footer; the header has a Close button of its own.
const footerButton = (dialog: Locator, name: string) =>
  dialog.locator('.pf-v6-c-modal-box__footer').getByRole('button', { name });

const resultRow = (dialog: Locator, name: string) =>
  dialog.getByRole('grid', { name: 'Results' }).getByRole('row', { name });

async function labelsOf(href: string): Promise<Record<string, string | null>> {
  const { pulp_labels: labels } = await objects.get(href);
  return (labels ?? {}) as Record<string, string | null>;
}

test('a label added to two repositories and removed from three is reported row by row, and a row without it is skipped', async ({
  page,
}) => {
  const key = labelKey();
  const [a, b] = withRemote;

  await openRun(page, '');
  for (const row of [a, b]) {
    await tick(page, row.name as string);
  }
  let dialog = await chooseBulkAction(page, 'Add label');
  await dialog.getByRole('textbox', { name: 'Label key' }).fill(key);
  await dialog.getByRole('textbox', { name: 'Label value' }).fill('first');
  await dialog.getByRole('button', { name: 'Add label', exact: true }).click();
  for (const row of [a, b]) {
    await expect(resultRow(dialog, row.name as string)).toContainText(
      'Succeeded',
    );
  }
  await footerButton(dialog, 'Close').click();
  await expect(
    page.getByText('Adding the label to the selected rows finished'),
  ).toBeVisible();

  expect(await labelsOf(a.pulp_href as string)).toMatchObject({
    [key]: 'first',
  });
  expect(await labelsOf(b.pulp_href as string)).toMatchObject({
    [key]: 'first',
  });
  expect(await labelsOf(withoutRemote.pulp_href)).not.toHaveProperty(key);

  // all three, so one of them has nothing to remove
  await page
    .getByRole('checkbox', { name: 'Select all repositories on this page' })
    .check();
  dialog = await chooseBulkAction(page, 'Remove label');
  await dialog.getByRole('textbox', { name: 'Label key' }).fill(key);
  await expect(
    dialog.getByText('Does not have this label, so it is skipped'),
  ).toHaveCount(1);
  await dialog
    .getByRole('button', { name: 'Remove label', exact: true })
    .click();
  for (const row of [a, b]) {
    await expect(resultRow(dialog, row.name as string)).toContainText(
      'Succeeded',
    );
  }
  await expect(resultRow(dialog, withoutRemote.name as string)).toContainText(
    'Skipped',
  );
  await footerButton(dialog, 'Close').click();
  await expect(
    page.getByText('Removing the label from the selected rows finished'),
  ).toBeVisible();

  for (const row of [a, b, withoutRemote]) {
    expect(
      await labelsOf(row.pulp_href),
      `labels of ${row.name}`,
    ).not.toHaveProperty(key);
  }
});

// Waits until no task holds the repository any more.
async function untilIdle(href: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (
          await objects.list('tasks/', {
            reserved_resources: href,
            state__in: 'waiting,running',
            fields: 'pulp_href',
          })
        ).length,
      { message: `tasks holding ${href}`, timeout: 120_000 },
    )
    .toBe(0);
}

test('a sync of three repositories starts one task for each that has a remote and skips the one that has none', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openRun(page, '');
  await page
    .getByRole('checkbox', { name: 'Select all repositories on this page' })
    .check();
  const dialog = await chooseBulkAction(page, 'Sync');
  await expect(dialog).toContainText('Has no remote, so it is skipped');
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();

  for (const row of withRemote) {
    const line = resultRow(dialog, row.name as string);
    await expect(line).toContainText('Started');
    await expect(
      line.getByRole('link', { name: 'View the task' }),
    ).toBeVisible();
  }
  await expect(resultRow(dialog, withoutRemote.name as string)).toContainText(
    'Skipped',
  );
  await expect(dialog).toContainText('No remote to sync from.');
  await footerButton(dialog, 'Close').click();
  await expect(
    page.getByText('Syncing the selected repositories was requested'),
  ).toBeVisible();

  for (const row of withRemote) {
    await untilIdle(row.pulp_href);
    const synced = await objects.list('tasks/', {
      reserved_resources: row.pulp_href,
      name: SYNC_TASK,
      fields: 'state',
    });
    expect(synced, `sync tasks of ${row.name}`).toHaveLength(1);
    expect(synced[0]?.['state'], `state of the sync of ${row.name}`).toBe(
      'completed',
    );
  }
  const none = await objects.list('tasks/', {
    reserved_resources: withoutRemote.pulp_href,
    name: SYNC_TASK,
    fields: 'state',
  });
  expect(none, 'sync tasks of the repository without a remote').toEqual([]);
});

async function makeRepositories(stem: string, count: number) {
  return Promise.all(
    Array.from({ length: count }, (_, index) =>
      objects.create(REPOSITORIES, {
        name: objects.name(`${stem}-${index + 1}`),
      }),
    ),
  );
}

const listed = (stem: string) =>
  objects.list(REPOSITORIES, {
    name__startswith: objects.name(`${stem}-`),
    fields: 'name',
  });

test('a bulk delete shows each repository as removed in the result table', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const doomed = await makeRepositories('delete-here', 2);

  await openRun(page, 'delete-here');
  await page
    .getByRole('checkbox', { name: 'Select all repositories on this page' })
    .check();
  const dialog = await chooseBulkAction(page, 'Delete');
  await expect(dialog).toContainText('Delete selected repositories?');
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  for (const row of doomed) {
    await expect(resultRow(dialog, row.name as string)).toContainText(
      'Succeeded',
      { timeout: 60_000 },
    );
  }
  await footerButton(dialog, 'Close').click();
  await expect(
    page.getByText('Deleting the selected repositories finished'),
  ).toBeVisible();

  expect(await listed('delete-here'), 'repositories left').toEqual([]);
});

test('a bulk delete that ends after the user has left the list reports on the screen they went to', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await makeRepositories('delete-away', 2);

  // Two screens of the application in a row, so that going back is a move
  // inside it and the run goes on in the page.
  await page.goto('file/remotes');
  await expect(title(page, 'Remotes')).toBeVisible();
  await clickSidebar(page, 'file-repositories');
  await expect(listTable(page, 'Repositories', { rows: true })).toBeVisible();
  const box = page.getByRole('textbox', { name: 'name__icontains' });
  await box.fill(objects.name('delete-away'));
  await box.press('Enter');
  await expect(listTable(page, 'Repositories', { rows: true })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);

  await page
    .getByRole('checkbox', { name: 'Select all repositories on this page' })
    .check();
  const dialog = await chooseBulkAction(page, 'Delete');
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();

  // back to the remote list through the history: the list and its dialog end
  await page.goBack();
  await page.goBack();
  await expect(title(page, 'Remotes')).toBeVisible();
  await expect(
    page.getByText('Deleting the selected repositories finished'),
  ).toBeVisible({ timeout: 60_000 });

  expect(await listed('delete-away'), 'repositories left').toEqual([]);
});
