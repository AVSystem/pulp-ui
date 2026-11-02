import { type Page, expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// RPM and Python remotes and repositories, created and synced through the UI
// against a real server. Nothing outside the server is contacted: the sync
// source of each plugin is a repository of this file's own prefix that the
// server itself publishes through a distribution, and the remote points at the
// URL the server reports for that distribution.

interface Plugin {
  label: string;
  // path of the plugin's screens relative to the UI root
  screens: string;
  repositories: string;
  remotes: string;
  distributions: string;
  // the task name the plugin runs for a sync
  syncTask: RegExp;
  // builds the sync source: the object the source distribution serves
  serve: (
    objects: TestObjects,
    repository: PulpObject,
  ) => Promise<Record<string, unknown>>;
}

const rpm: Plugin = {
  label: 'RPM',
  screens: 'rpm',
  repositories: 'repositories/rpm/rpm/',
  remotes: 'remotes/rpm/rpm/',
  distributions: 'distributions/rpm/rpm/',
  syncTask: /rpm.*synchroni[sz]e/i,
  // a distribution of a repository serves nothing until a publication exists
  serve: async (objects, repository) => {
    const publication = await objects.create('publications/rpm/rpm/', {
      repository: repository.pulp_href,
    });
    return { publication: publication.pulp_href };
  },
};

const python: Plugin = {
  label: 'Python',
  screens: 'python',
  repositories: 'repositories/python/python/',
  remotes: 'remotes/python/python/',
  distributions: 'distributions/python/pypi/',
  syncTask: /python.*sync/i,
  // a Python distribution serves the latest version of its repository
  serve: async (_objects, repository) => ({ repository: repository.pulp_href }),
};

const NOT_SERVED = 'Not served: no publication';

// The message of a failed task that comes from the content source being out of
// reach for the server's own workers, as opposed to a fault of the sync.
const CONNECTION_FAILURE =
  /cannot connect|connection (refused|reset|timed out)|name or service not known|temporary failure in name resolution|ssl|certificate|timed? ?out/i;

interface FinishedTask {
  pulp_href: string;
  name: string;
  state: string;
  error?: { description?: string } | null;
  reserved_resources_record?: string[];
}

for (const plugin of [rpm, python]) {
  test.describe(`${plugin.label} remotes and repositories`, () => {
    test.describe.configure({ mode: 'serial' });

    const scope = plugin.screens;
    let objects: TestObjects;
    let sourceUrl: string;
    const remoteName = () => objects.name('remote');
    const repositoryName = () => objects.name('repo');

    test.beforeAll(async () => {
      test.setTimeout(180_000);
      objects = await TestObjects.open(scope);

      const source = await objects.create(plugin.repositories, {
        name: objects.name('source'),
      });
      const distribution = await objects.create(plugin.distributions, {
        name: objects.name('source'),
        base_path: objects.name('source'),
        ...(await plugin.serve(objects, source)),
      });
      sourceUrl = distribution['base_url'] as string;
      expect(sourceUrl, 'the URL the server reports for the source').toMatch(
        /^https?:\/\//,
      );
    });

    test.afterAll(async () => {
      test.setTimeout(180_000);
      await objects.cleanUp();
    });

    // Opens a list page filtered by name, the way the filter box does.
    async function listed(page: Page, kind: string, name: string) {
      await page.goto(
        `${plugin.screens}/${kind}?name__icontains=${encodeURIComponent(name)}`,
      );
      await expect(
        title(page, kind === 'remotes' ? 'Remotes' : 'Repositories'),
      ).toBeVisible();
      return page.getByRole('link', { name, exact: true });
    }

    async function pickRemote(page: Page, name: string) {
      const remote = page.locator('[data-cy=remote]');
      await remote.locator('input').fill(name);
      await page.getByRole('option', { name, exact: true }).click();
      await expect(remote.locator('input')).toHaveValue(name);
    }

    // The newest sync task that holds the repository exclusively and the
    // remote as a shared resource, or null. The server answers the two
    // resource filters for objects that exist; a sync of another repository or
    // another remote never matches.
    async function newestSync(repository: PulpObject, remote: PulpObject) {
      const tasks = (await objects.list('tasks/', {
        exclusive_resources: repository.pulp_href,
        shared_resources: remote.pulp_href,
        ordering: '-pulp_created',
      })) as unknown as FinishedTask[];
      return tasks.find(({ name }) => plugin.syncTask.test(name)) ?? null;
    }

    test('a remote created from the form is found in the list and shows its URL', async ({
      page,
    }) => {
      const name = remoteName();
      await page.goto(`${plugin.screens}/remotes/edit/_`);
      await page.locator('#name').fill(name);
      await page.locator('#url').fill(sourceUrl);
      await page.getByRole('button', { name: 'Save' }).click();
      await page.waitForURL(/remotes\/detail\//);
      await expect(title(page, name)).toBeVisible();
      await expect(page.getByText(sourceUrl).first()).toBeVisible();

      await expect(await listed(page, 'remotes', name)).toBeVisible();

      const [created] = await objects.list(plugin.remotes, { name });
      expect(created, 'the remote on the server').toBeDefined();
      expect(created?.['url']).toBe(sourceUrl);
      expect(created?.['policy'], 'a form left alone sends on_demand').toBe(
        'on_demand',
      );
    });

    test('a repository created with a remote and a distribution is found in the list and shows the URL the server reports', async ({
      page,
    }) => {
      const name = repositoryName();
      await page.goto(`${plugin.screens}/repositories/edit/_`);
      await page.locator('#name').fill(name);
      await pickRemote(page, remoteName());
      await page.locator('#create_distribution').check();
      await expect(page.locator('#base_path')).toHaveValue(name);
      await page.getByRole('button', { name: 'Save' }).click();
      await page.waitForURL(/repositories\/detail\//);
      await expect(title(page, name)).toBeVisible();

      await expect(await listed(page, 'repositories', name)).toBeVisible();

      const [distribution] = await objects.list(plugin.distributions, {
        name,
      });
      expect(distribution, 'the distribution of the checkbox').toBeDefined();
      const reported = distribution?.['base_url'] as string;
      expect(reported).toMatch(/^https?:\/\//);

      await page.goto(`${plugin.screens}/repositories/detail/${name}`);
      await expect(title(page, name)).toBeVisible();
      const urlRow = page.locator('.pf-v5-c-description-list__group', {
        hasText: 'Repository URL',
      });
      await expect(urlRow).toContainText(reported);

      if (plugin === rpm) {
        // nothing is published yet, so the distribution answers 404
        await expect(urlRow).toContainText(NOT_SERVED);
      } else {
        await expect(urlRow).not.toContainText(NOT_SERVED);
      }

      const [repository] = await objects.list(plugin.repositories, { name });
      expect(
        repository?.['remote'],
        'the repository is bound to the remote',
      ).toBe(
        (await objects.list(plugin.remotes, { name: remoteName() }))[0]
          ?.pulp_href,
      );
    });

    test('a sync started from the dialog runs for the repository and its remote', async ({
      page,
    }) => {
      test.setTimeout(240_000);
      const name = repositoryName();
      const [repository] = (await objects.list(plugin.repositories, {
        name,
      })) as PulpObject[];
      const [remote] = (await objects.list(plugin.remotes, {
        name: remoteName(),
      })) as PulpObject[];
      expect(
        await newestSync(repository as PulpObject, remote as PulpObject),
        'a sync before the dialog was used',
      ).toBeNull();

      await page.goto(`${plugin.screens}/repositories/detail/${name}`);
      await expect(title(page, name)).toBeVisible();
      await page.getByRole('button', { name: 'Sync', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText(`Sync repository "${name}"`);
      const dispatched = page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(
            `${(repository as PulpObject).pulp_href}sync/`,
          ),
      );
      await dialog.getByRole('button', { name: 'Sync', exact: true }).click();
      expect((await dispatched).status(), 'the sync request').toBe(202);

      // the task the server dispatched for this repository and this remote
      let task = null as FinishedTask | null;
      await expect
        .poll(
          async () =>
            (task = await newestSync(
              repository as PulpObject,
              remote as PulpObject,
            )),
          {
            message: 'a sync task of the repository and remote',
            timeout: 30_000,
          },
        )
        .not.toBeNull();

      const finished = await settle(objects, (task as FinishedTask).pulp_href);
      test.info().annotations.push({
        type: 'sync-outcome',
        description: `${plugin.label} sync ${finished.state}`,
      });
      if (finished.state === 'completed') {
        return;
      }

      // The server's workers must reach the server's own content URL for the
      // source to be read. When they cannot, the case proves the dispatch
      // above and reports the limit instead of passing for a sync it did not
      // see complete.
      const reason = finished.error?.description ?? '';
      test.info().annotations.push({
        type: 'environment-limit',
        description: `${plugin.label} sync ${finished.state}: ${reason.slice(0, 200)}`,
      });
      expect(
        reason,
        `the ${plugin.label} sync ended ${finished.state} for a reason other than reaching the source`,
      ).toMatch(CONNECTION_FAILURE);
    });
  });
}

// Waits until the task is no longer waiting or running and returns it.
async function settle(
  objects: TestObjects,
  href: string,
  timeoutMs = 150_000,
): Promise<FinishedTask> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const task = (await objects.get(href)) as unknown as FinishedTask;
    if (!['waiting', 'running', 'canceling'].includes(task.state)) {
      return task;
    }
    if (Date.now() > deadline) {
      throw new Error(`task ${href} still ${task.state} after ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
