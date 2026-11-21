import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PLUGIN_MANIFESTS, type PluginManifest } from 'src/framework/manifest';
import { frameworkRoutes } from 'src/framework/routes';
import { WatchedTasksProvider } from 'src/framework/watched-tasks';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  inSetOf,
  listOf,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  projectedBy,
  pythonDistribution,
  task,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';

// The Edit distribution action of the Distributions tab of a python
// repository: shown to an account that may change distributions, it changes the
// pull-through remote and the upload permission of one distribution and nothing
// else.

const API = '/pulp/api/v3';
const CHANGE = 'python.change_pythondistribution';
const DISTRIBUTIONS = `${API}/distributions/python/pypi/`;
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

const PYTHON: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'python',
  ) as PluginManifest),
  onFramework: true,
};

const repository = pluginRepository('python', { name: 'zz-test-python' });
const mirror = pluginRemote('python', { name: 'zz-mirror' });
const other = pluginRemote('python', { name: 'zz-other' });

const served = pythonDistribution({
  name: 'zz-served',
  base_path: 'bp-served',
  repository: repository.pulp_href,
  remote: null,
  allow_uploads: true,
});

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let patchBodies: Record<string, unknown>[];
let account: { stop: () => void };

const writes = () =>
  seen.filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`);
const reads = (path: string) =>
  seen.filter((r) => r.method === 'GET' && r.path === path).length;

beforeEach(() => {
  seen = [];
  patchBodies = [];
  // an account whose own role lets it change distributions
  account = servePermissions({ id: 7, isStaff: false, own: [[CHANGE]] });
  server.events.on('request:start', ({ request }) => {
    seen.push({ method: request.method, path: new URL(request.url).pathname });
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  account.stop();
});

function serveLab(rows = [served]) {
  server.use(
    pluginListHandler('python', 'repository', [repository]).handler,
    pluginListHandler('python', 'remote', [mirror, other], {
      pageSize: 1000,
    }).handler,
    listOf(`${API}/remotes/`, [mirror, other], {
      pageSize: 1000,
      matching: (row, query) => {
        const hrefs = inSetOf(query, 'pulp_href__in');
        return hrefs === null || hrefs.includes(row.pulp_href);
      },
      projected: projectedBy,
    }).handler,
    distributionListHandler('python', rows).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    ...rows.map((row) =>
      http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)),
    ),
  );
}

function servePatch(answer: () => Response, row = served) {
  server.use(
    http.patch(`*${row.pulp_href}`, async ({ request }) => {
      patchBodies.push((await request.json()) as Record<string, unknown>);
      return answer();
    }),
    http.get(`*${TASK_HREF}`, () =>
      HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
    ),
  );
}

const startsTask = () =>
  HttpResponse.json({ task: TASK_HREF }, { status: 202 });

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([PYTHON])))}
    </>
  );
}

function renderTab() {
  return renderWithProviders(
    <AppContextProvider>
      <WatchedTasksProvider>
        <PermissionsKnown>
          <Routed />
        </PermissionsKnown>
      </WatchedTasksProvider>
    </AppContextProvider>,
    { route: '/python/repositories/zz-test-python/distributions' },
  );
}

const rowOf = async (name: string) =>
  (await screen.findByText(name)).closest('tr') as HTMLElement;

async function openEditDialog(user: ReturnType<typeof renderTab>['user']) {
  const row = await rowOf('zz-served');
  await user.click(within(row).getByRole('button', { name: /actions/i }));
  await user.click(
    await screen.findByRole('menuitem', { name: 'Edit distribution' }),
  );
  return screen.findByRole('dialog');
}

const uploadsBox = (dialog: HTMLElement) =>
  within(dialog).getByRole('checkbox', { name: /Allow uploads/ });
const saveButton = (dialog: HTMLElement) =>
  within(dialog).getByRole('button', { name: /^Save/ });

async function chooseRemote(
  user: ReturnType<typeof renderTab>['user'],
  dialog: HTMLElement,
  name: string,
) {
  await user.click(within(dialog).getByPlaceholderText('Select a remote'));
  await user.click(await screen.findByRole('option', { name }));
}

describe(
  'Integration: who is offered Edit distribution',
  { tags: ['integration'] },
  () => {
    it('offers it on every row to an account that holds the change permission on every distribution, with no read of any distribution for its permissions', async () => {
      serveLab([
        served,
        pythonDistribution({
          name: 'zz-second',
          base_path: 'bp-second',
          repository: repository.pulp_href,
        }),
      ]);
      const { user } = renderTab();

      for (const name of ['zz-served', 'zz-second']) {
        const row = await rowOf(name);
        await user.click(within(row).getByRole('button', { name: /actions/i }));
        expect(
          await screen.findByRole('menuitem', { name: 'Edit distribution' }),
        ).toBeVisible();
        await user.keyboard('{Escape}');
      }
      expect(
        seen.filter(({ path }) => path.includes('my_permissions')),
      ).toEqual([]);
    });

    it('offers nothing to an account that may only view', async () => {
      account.stop();
      account = servePermissions({
        id: 7,
        isStaff: false,
        own: [['python.view_pythondistribution']],
      });
      serveLab();
      renderTab();

      const row = await rowOf('zz-served');

      expect(
        within(row).queryByRole('button', { name: /actions/i }),
      ).toBeNull();
    });
  },
);

describe(
  'Integration: editing a python distribution',
  { tags: ['integration'] },
  () => {
    beforeEach(() => {
      serveLab();
    });

    it('opens a dialog with the current remote, by its name, and the upload permission of the distribution', async () => {
      const row = pythonDistribution({
        name: 'zz-served',
        base_path: 'bp-served',
        repository: repository.pulp_href,
        remote: mirror.pulp_href,
        allow_uploads: false,
      });
      serveLab([row]);
      const { user } = renderTab();

      const dialog = await openEditDialog(user);

      await waitFor(() => expect(uploadsBox(dialog)).not.toBeChecked());
      expect(
        await within(dialog).findByDisplayValue('zz-mirror'),
      ).toBeVisible();
    });

    it('sends only the remote when a remote is chosen', async () => {
      servePatch(startsTask);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await chooseRemote(user, dialog, 'zz-other');
      await user.click(saveButton(dialog));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).toStrictEqual({ remote: other.pulp_href });
      expect(writes()).toEqual([`PATCH ${served.pulp_href}`]);
    });

    it('sends only allow_uploads when uploads are switched off', async () => {
      servePatch(startsTask);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await user.click(uploadsBox(dialog));
      await user.click(saveButton(dialog));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).toStrictEqual({ allow_uploads: false });
    });

    it('sends remote null when the remote is cleared', async () => {
      const row = pythonDistribution({
        name: 'zz-served',
        base_path: 'bp-served',
        repository: repository.pulp_href,
        remote: mirror.pulp_href,
      });
      serveLab([row]);
      servePatch(startsTask, row);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await within(dialog).findByDisplayValue('zz-mirror');

      await user.click(within(dialog).getByRole('button', { name: 'Clear' }));
      await user.click(saveButton(dialog));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).toStrictEqual({ remote: null });
    });

    it('never sends a name, a base path, a repository or a content guard, whatever is changed', async () => {
      servePatch(startsTask);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await chooseRemote(user, dialog, 'zz-mirror');
      await user.click(uploadsBox(dialog));
      await user.click(saveButton(dialog));

      await waitFor(() => expect(patchBodies).toHaveLength(1));
      expect(patchBodies[0]).toStrictEqual({
        remote: mirror.pulp_href,
        allow_uploads: false,
      });
      for (const body of patchBodies) {
        for (const key of Object.keys(body)) {
          expect(['remote', 'allow_uploads']).toContain(key);
        }
      }
    });

    it('sends no request when nothing changed, says so and closes', async () => {
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await user.click(saveButton(dialog));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(writes()).toEqual([]);
      expect(
        await screen.findByText(/Nothing changed in distribution zz-served/),
      ).toBeInTheDocument();
    });

    it('closes when the server starts a task, says the update started with the task link, follows the task and reads the distributions again', async () => {
      servePatch(startsTask);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
      const loadsBefore = reads(DISTRIBUTIONS);

      await user.click(uploadsBox(dialog));
      await user.click(saveButton(dialog));

      expect(
        await screen.findByText(/Update started for distribution zz-served/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() => expect(reads(TASK_HREF)).toBeGreaterThanOrEqual(1));
      await waitFor(() =>
        expect(reads(DISTRIBUTIONS)).toBeGreaterThan(loadsBefore),
      );
      expect(
        screen.getByRole('link', { name: /detail page/ }),
      ).toBeInTheDocument();
    });

    it('reports a plain update when the server answers with the object itself, and follows no task', async () => {
      servePatch(() => HttpResponse.json(served));
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await user.click(uploadsBox(dialog));
      await user.click(saveButton(dialog));

      expect(
        await screen.findByText(/Updated distribution zz-served/),
      ).toBeInTheDocument();
      expect(reads(TASK_HREF)).toBe(0);
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it("shows the server's field error in the dialog and keeps it open on a 400", async () => {
      servePatch(() =>
        HttpResponse.json(
          { remote: ['Invalid hyperlink - Object does not exist.'] },
          { status: 400 },
        ),
      );
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await chooseRemote(user, dialog, 'zz-other');
      await user.click(saveButton(dialog));

      expect(
        await within(dialog).findByText(/Object does not exist/),
      ).toBeInTheDocument();
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      // the button works again, and what was chosen is kept
      await waitFor(() => expect(saveButton(dialog)).toBeEnabled());
      expect(within(dialog).getByDisplayValue('zz-other')).toBeVisible();
    });

    it('shows a refusal in the dialog and keeps it open', async () => {
      servePatch(() =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        ),
      );
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());

      await user.click(uploadsBox(dialog));
      await user.click(saveButton(dialog));

      // the refusal is described in three parts, each naming the permission
      expect(
        (await within(dialog).findAllByText(/do not have permission/)).length,
      ).toBeGreaterThan(0);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('sends one PATCH for a double click on Save', async () => {
      servePatch(startsTask);
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
      await user.click(uploadsBox(dialog));

      await user.dblClick(saveButton(dialog));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(patchBodies).toHaveLength(1);
    });

    it('closes on Cancel without a request', async () => {
      const { user } = renderTab();
      const dialog = await openEditDialog(user);
      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
      await user.click(uploadsBox(dialog));

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('dialog')).toBeNull();
      expect(writes()).toEqual([]);
    });

    it('shows a failed read of the distribution with Retry and the form once it is read', async () => {
      let failing = true;
      server.use(
        http.get(`*${served.pulp_href}`, () =>
          failing
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(served),
        ),
      );
      const { user } = renderTab();
      const dialog = await openEditDialog(user);

      expect(
        await within(dialog).findByText(/Failed to load the distribution/),
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('checkbox', { name: /Allow uploads/ }),
      ).toBeNull();

      failing = false;
      await user.click(within(dialog).getByRole('button', { name: 'Retry' }));

      await waitFor(() => expect(uploadsBox(dialog)).toBeChecked());
    });
  },
);
