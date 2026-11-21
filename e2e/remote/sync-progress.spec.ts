import { type Page, expect, test } from '@playwright/test';
import { getDistributionsFileFileListUrl } from '@pulp-ui/sdk/file/distributions-file';
import { getRemotesFileFileListUrl } from '@pulp-ui/sdk/file/remotes-file';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// Following a sync on a real server: the repository screen shows the stages of
// the running task with how far each has come until it ends, a sync the user
// has left behind is announced on the screen they went to, the last sync shows
// on the Details tab, and a running sync is stopped through the panel after a
// confirmation. The repositories belong to this run; the sync source is the
// lab's own, served by the deployment, and the remote is slowed down by a rate
// limit so that a sync is still running when the page looks at it.

const REPOSITORIES = getRepositoriesFileFileListUrl();
const REMOTES = getRemotesFileFileListUrl();
const SYNC_TASK = 'pulp_file.app.tasks.synchronizing.synchronize';

let objects: TestObjects;
let remote: PulpObject;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('syncprog');

  const [source] = await objects.list(getDistributionsFileFileListUrl(), {
    name: 'zz-synth-sync-source',
    fields: 'base_url',
  });
  const sourceUrl = source?.['base_url'] as string;
  expect(sourceUrl, 'the URL of the seeded sync source').toMatch(
    /^https?:\/\//,
  );

  // 300 files at 25 requests a second keep a sync busy for about twelve
  // seconds.
  remote = await objects.create(REMOTES, {
    name: objects.name('remote'),
    url: `${sourceUrl}PULP_MANIFEST`,
    policy: 'immediate',
    rate_limit: 25,
  });
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

async function repositoryWithRemote(suffix: string): Promise<string> {
  const repository = await objects.create(REPOSITORIES, {
    name: objects.name(suffix),
    remote: remote.pulp_href,
  });
  return repository.name as string;
}

// Opens the repository's own screen and starts a sync from its Sync button.
async function startSync(page: Page, name: string): Promise<void> {
  await page.goto(`file/repositories/${encodeURIComponent(name)}`);
  await expect(title(page, name)).toBeVisible();
  await page.getByRole('button', { name: 'Sync', exact: true }).click();
  const dialog = page.locator('[data-cy=SyncDialog]');
  await expect(dialog).toContainText(`Sync repository "${name}"`);
  // a second sync of the same content would be skipped when nothing changed
  await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
  // the dialog closes once the server has taken the request; the screen shows
  // the progress
  await expect(dialog).toHaveCount(0);
}

const panel = (page: Page) => page.locator('[data-cy=SyncProgress]');

test('a sync shows its stages with how far each has come until it ends', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const name = await repositoryWithRemote('follow');
  await startSync(page, name);

  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText(/Sync (queued|running)/);
  // a stage with a total shows done over total
  await expect(
    panel(page).locator('[data-cy=ProgressReport]').first(),
  ).toBeVisible();
  await expect(panel(page)).toContainText(/\d+\/\d+/);

  // the same panel carries it to its end and keeps the final state
  await expect(panel(page)).toContainText('Sync completed', {
    timeout: 90_000,
  });
  await expect(panel(page)).not.toContainText('Cancel sync');
  await expect(
    panel(page).getByRole('link', { name: 'View the task' }),
  ).toBeVisible();
});

test('a sync the user has left is announced on the screen they went to, and the Details tab shows it as the last sync', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const name = await repositoryWithRemote('away');
  await startSync(page, name);
  await expect(panel(page)).toBeVisible();

  // leave the repository for the task list, inside the application
  await page.locator('[data-cy=pulp-menu-item-tasks]').click();
  await expect(title(page, 'Task management')).toBeVisible();

  const finished = page.getByRole('heading', {
    name: new RegExp(`Sync of ${name} finished`),
  });
  await expect(finished).toBeVisible({ timeout: 90_000 });
  await expect(
    finished
      .locator('xpath=ancestor::*[contains(@class, "pf-v6-c-alert")]')
      .getByRole('link', { name: 'View the task' }),
  ).toBeVisible();

  await page.goto(`file/repositories/${encodeURIComponent(name)}`);
  const lastSync = page.locator('.pf-v6-c-description-list__group', {
    hasText: 'Last sync',
  });
  await expect(lastSync).toContainText('Completed');
  await expect(
    lastSync.getByRole('link', { name: 'View the task' }),
  ).toBeVisible();
  await expect(lastSync).not.toContainText('Never synced');
});

test('a running sync is stopped through the panel after a confirmation', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const name = await repositoryWithRemote('stop');
  await startSync(page, name);
  await expect(panel(page)).toBeVisible();

  await panel(page).getByRole('button', { name: 'Cancel sync' }).click();
  const confirm = page.getByRole('dialog', { name: 'Cancel sync' });
  await expect(confirm).toContainText('will stop running');
  // keeping it running closes the question and leaves the task alone
  await confirm.getByRole('button', { name: 'Keep running' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(panel(page)).toContainText(/Sync (queued|running)/);

  await panel(page).getByRole('button', { name: 'Cancel sync' }).click();
  await page.getByRole('button', { name: 'Yes, cancel' }).click();

  await expect(panel(page)).toContainText(/Sync (is being canceled|canceled)/, {
    timeout: 60_000,
  });
  await expect(panel(page)).toContainText('Sync canceled', { timeout: 60_000 });

  const tasks = await objects.list('tasks/', {
    name: SYNC_TASK,
    reserved_resources: (
      await objects.list(REPOSITORIES, {
        name: name,
        fields: 'pulp_href',
      })
    )[0]?.pulp_href as string,
    fields: 'state',
  });
  expect(tasks.map((task) => task['state'])).toEqual(['canceled']);
});
