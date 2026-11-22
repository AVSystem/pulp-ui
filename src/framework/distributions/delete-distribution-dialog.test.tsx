import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import type { AlertType } from 'src/components';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type TestDistributionPlugin,
  artifactDistribution,
  coreDistributionListHandler,
  coreDistributionRow,
  distributionListHandler,
  listOf,
  page,
  pluginDistribution,
  projectedBy,
  role,
  roleAssignment,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { frameworkCoreRoutes } from '../routes';
import { WatchedTasksProvider } from '../watched-tasks';
import { DeleteDistributionDialog } from './delete-distribution-dialog';

const API = '/pulp/api/v3';
const TASK_ID = '5f1c3a0e-7d2b-4c1e-9a55-0c9d2e3f4a5b';
const TASK_HREF = `${API}/tasks/${TASK_ID}/`;

let account: { stop: () => void };

beforeEach(() => {
  account = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  account.stop();
  resetSessionEvents();
});

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkCoreRoutes()))}
    </>
  );
}

function renderList() {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <WatchedTasksProvider>
          <Routed />
        </WatchedTasksProvider>
      </PermissionsKnown>
    </AppContextProvider>,
    { route: '/distributions', signedIn: true },
  );
}

// The task a delete starts, which the application root follows to its end.
function serveTask(state: 'running' | 'completed' = 'completed') {
  server.use(
    http.get(`*${API}/tasks/:id/`, () =>
      HttpResponse.json({
        ...task({ pulp_href: TASK_HREF, state }),
        name: 'delete',
      }),
    ),
  );
}

// The deletes the server received, by path, and what it answers them.
function serveDeletes(
  answer: (path: string) => Response | Promise<Response> = () =>
    HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
) {
  const deletes: string[] = [];
  server.use(
    http.delete(`*${API}/distributions/:app/:type/:id/`, ({ request }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      return answer(path);
    }),
  );

  return { deletes };
}

// The rows of every plugin, answered by the cross-plugin list and by each
// plugin's own list. The rows may be changed by the test between reads.
function serveLab(
  rows: Partial<Record<TestDistributionPlugin, IDistribution[]>>,
) {
  const own = Object.entries(rows).map(([plugin, list]) =>
    distributionListHandler(plugin as TestDistributionPlugin, list ?? []),
  );
  const core = coreDistributionListHandler([
    ...Object.values(rows)
      .flatMap((list) => list ?? [])
      .map(coreDistributionRow),
    artifactDistribution(),
  ]);
  server.use(core.handler, ...own.map(({ handler }) => handler));

  return { core, own };
}

// The roles the signed-in user holds on single distributions and what each role
// allows, as the server lists them. Nothing is held on every object.
function serveRolesOnObjects(
  grants: { role: string; permissions: string[]; on: IDistribution }[],
) {
  const own = listOf(
    `${API}/users/7/roles/`,
    grants.map(({ role: name, on }) => roleAssignment(name, on.pulp_href)),
    {
      pageSize: 1000,
      matching: (row, query) =>
        query.get('content_object') !== 'null' || row.content_object === null,
      projected: projectedBy,
    },
  );
  const catalogue: string[] = [];
  server.use(
    own.handler,
    http.get(`*${API}/roles/`, ({ request }) => {
      catalogue.push(new URL(request.url).pathname);
      return HttpResponse.json(
        page(
          grants.map(({ role: name, permissions }) =>
            role({ name, permissions }),
          ),
        ),
      );
    }),
  );

  return { own, catalogue };
}

const rowOf = (name: string) =>
  screen.getByText(name).closest('tr') as HTMLElement;

const kebabOf = (row: HTMLElement) =>
  within(row).queryByRole('button', { name: /actions|kebab/i });

const tableOf = () => screen.findByRole('grid', { name: 'Distributions' });

const settled = (table: HTMLElement) =>
  waitFor(() => expect(table).toHaveAttribute('data-columns-loaded', 'true'), {
    timeout: 20_000,
  });

const DELETE_PYTHON = 'python.delete_pythondistribution';
const DELETE_ANSIBLE = 'ansible.delete_ansibledistribution';

describe(
  'Integration: the delete dialog of a distribution',
  { tags: ['integration'] },
  () => {
    function renderDialog({
      plugin = 'python',
      onAccepted = () => undefined,
      onClose = () => undefined,
    }: {
      plugin?: TestDistributionPlugin;
      onAccepted?: (alert: AlertType) => void;
      onClose?: () => void;
    } = {}) {
      const row = pluginDistribution(plugin, {
        name: 'wheels',
        base_path: 'index/wheels',
      });
      const rendered = renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <WatchedTasksProvider>
              <DeleteDistributionDialog
                plugin={plugin}
                distribution={row}
                onClose={onClose}
                onAccepted={onAccepted}
              />
            </WatchedTasksProvider>
          </PermissionsKnown>
        </AppContextProvider>,
        { signedIn: true },
      );

      return { ...rendered, row };
    }

    const confirmButton = () =>
      within(screen.getByRole('dialog')).getByRole('button', {
        // while a delete is on its way the button also names its spinner
        name: /^Delete/,
      });

    it('asks a plain question that names the distribution and its base path', async () => {
      renderDialog();

      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Delete distribution?')).toBeVisible();
      expect(within(dialog).getByText('wheels')).toBeVisible();
      expect(within(dialog).getByText('index/wheels')).toBeVisible();
    });

    it('sends one delete to the endpoint of the distribution plugin, however often Delete is pressed before the server answers, and hands the task on', async () => {
      serveTask();
      let open: () => void = () => undefined;
      const answered = new Promise<void>((resolve) => {
        open = resolve;
      });
      const { deletes } = serveDeletes(async () => {
        await answered;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const accepted: AlertType[] = [];
      const { user, row } = renderDialog({
        plugin: 'ansible',
        onAccepted: (alert) => accepted.push(alert),
      });

      await screen.findByRole('dialog');
      await user.click(confirmButton());
      await user.click(confirmButton());
      await user.click(confirmButton());
      await waitFor(() => expect(deletes).toHaveLength(1));
      open();

      await waitFor(() => expect(accepted).toHaveLength(1));
      expect(deletes).toEqual([row.pulp_href]);
      expect(deletes[0]).toMatch(/\/distributions\/ansible\/ansible\//);
      expect(accepted[0]?.title).toBe(
        'Removal started for distribution wheels',
      );
    });

    it('stays open with the reason of the server when the delete is refused, and sends again when asked again', async () => {
      serveTask();
      let refuse = true;
      const { deletes } = serveDeletes(() =>
        refuse
          ? HttpResponse.json(
              { detail: 'You do not have permission to perform this action.' },
              { status: 403 },
            )
          : HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
      );
      const accepted: AlertType[] = [];
      const { user } = renderDialog({
        onAccepted: (alert) => accepted.push(alert),
      });

      await screen.findByRole('dialog');
      await user.click(confirmButton());

      expect(
        await screen.findByText(
          'You do not have permission to perform this action.',
        ),
      ).toBeVisible();
      expect(
        screen.getByText('Failed to delete distribution "wheels"'),
      ).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(accepted).toEqual([]);

      refuse = false;
      await user.click(confirmButton());
      await waitFor(() => expect(accepted).toHaveLength(1));
      expect(deletes).toHaveLength(2);
    });

    it('says the distribution may already be gone when the request got no answer', async () => {
      serveTask();
      serveDeletes(() => HttpResponse.error());
      const { user } = renderDialog();

      await screen.findByRole('dialog');
      await user.click(confirmButton());

      expect(
        await screen.findByText(/may already have been removed/),
      ).toBeVisible();
    });

    it('closes on Cancel and sends nothing', async () => {
      const { deletes } = serveDeletes();
      let closed = 0;
      const { user } = renderDialog({ onClose: () => (closed += 1) });

      await screen.findByRole('dialog');
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Cancel',
        }),
      );

      expect(closed).toBe(1);
      expect(deletes).toEqual([]);
    });
  },
);

describe(
  'Integration: Delete on a row of the distribution list',
  { tags: ['integration'] },
  () => {
    function asUserWithoutGlobalDelete() {
      account.stop();
      account = servePermissions({
        id: 7,
        isStaff: false,
        own: [
          [
            'python.view_pythondistribution',
            'ansible.view_ansibledistribution',
          ],
        ],
      });
    }

    it('offers Delete on the python and ansible rows the user holds the permission on through a role on that distribution, and on no other row', async () => {
      asUserWithoutGlobalDelete();
      const [wheelsA, wheelsB] = ['wheels-a', 'wheels-b'].map((name) =>
        pluginDistribution('python', { name, base_path: `path-${name}` }),
      ) as [IDistribution, IDistribution];
      const [galaxyA, galaxyB] = ['galaxy-a', 'galaxy-b'].map((name) =>
        pluginDistribution('ansible', { name, base_path: `path-${name}` }),
      ) as [IDistribution, IDistribution];
      serveLab({ python: [wheelsA, wheelsB], ansible: [galaxyA, galaxyB] });
      serveRolesOnObjects([
        {
          role: 'python.pythondistribution_owner',
          permissions: [DELETE_PYTHON],
          on: wheelsA,
        },
        {
          role: 'ansible.ansibledistribution_owner',
          permissions: [DELETE_ANSIBLE],
          on: galaxyA,
        },
      ]);
      serveTask();
      const { deletes } = serveDeletes();

      const { user } = renderList();
      const table = await tableOf();
      await settled(table);

      await waitFor(() => expect(kebabOf(rowOf('wheels-a'))).not.toBeNull());
      expect(kebabOf(rowOf('wheels-b'))).toBeNull();
      expect(kebabOf(rowOf('galaxy-a'))).not.toBeNull();
      expect(kebabOf(rowOf('galaxy-b'))).toBeNull();

      await user.click(kebabOf(rowOf('wheels-a')) as HTMLElement);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('wheels-a')).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(deletes).toEqual([wheelsA.pulp_href]));
      expect(deletes[0]).toMatch(/\/distributions\/python\/pypi\//);
    });

    it('does not offer Delete on a row of another plugin for the permission of a python role', async () => {
      asUserWithoutGlobalDelete();
      const wheels = pluginDistribution('python', {
        name: 'wheels',
        base_path: 'path-wheels',
      });
      const galaxy = pluginDistribution('ansible', {
        name: 'galaxy',
        base_path: 'path-galaxy',
      });
      serveLab({ python: [wheels], ansible: [galaxy] });
      serveRolesOnObjects([
        {
          role: 'python.pythondistribution_owner',
          permissions: [DELETE_PYTHON],
          on: wheels,
        },
      ]);

      renderList();
      const table = await tableOf();
      await settled(table);

      await waitFor(() => expect(kebabOf(rowOf('wheels'))).not.toBeNull());
      expect(kebabOf(rowOf('galaxy'))).toBeNull();
    });

    it('shows the refusal of the server in the dialog and leaves the list as it is', async () => {
      asUserWithoutGlobalDelete();
      const wheels = pluginDistribution('python', {
        name: 'wheels',
        base_path: 'path-wheels',
      });
      serveLab({ python: [wheels] });
      serveRolesOnObjects([
        {
          role: 'python.pythondistribution_owner',
          permissions: [DELETE_PYTHON],
          on: wheels,
        },
      ]);
      serveDeletes(() =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        ),
      );

      const { user } = renderList();
      const table = await tableOf();
      await settled(table);

      await waitFor(() => expect(kebabOf(rowOf('wheels'))).not.toBeNull());
      await user.click(kebabOf(rowOf('wheels')) as HTMLElement);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(
        await within(dialog).findByText(
          'You do not have permission to perform this action.',
        ),
      ).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(screen.getByText('wheels', { selector: 'a' })).toBeVisible();
    });

    it('reads the roles on single distributions only for a user who lacks the permission everywhere, and only for a plugin that has them', async () => {
      // a superuser holds every permission everywhere
      const wheels = pluginDistribution('python', {
        name: 'wheels',
        base_path: 'path-wheels',
      });
      const rolesRead: string[] = [];
      serveLab({ python: [wheels] });
      const onStart = ({ request }: { request: Request }) => {
        const { pathname } = new URL(request.url);
        if (pathname === `${API}/roles/`) {
          rolesRead.push(pathname);
        }
      };
      server.events.on('request:start', onStart);

      renderList();
      const table = await tableOf();
      await settled(table);

      await waitFor(() => expect(kebabOf(rowOf('wheels'))).not.toBeNull());
      server.events.removeListener('request:start', onStart);
      expect(rolesRead).toEqual([]);
    });

    it('reads the list again when the delete task ends', async () => {
      const wheels = pluginDistribution('python', {
        name: 'wheels',
        base_path: 'path-wheels',
      });
      const galaxy = pluginDistribution('ansible', {
        name: 'galaxy',
        base_path: 'path-galaxy',
      });
      const rows: Partial<Record<TestDistributionPlugin, IDistribution[]>> = {
        python: [wheels],
        ansible: [galaxy],
      };
      serveLab(rows);
      serveTask('completed');
      serveDeletes(() => {
        // the delete is done by the time the task has ended
        rows.python = [];
        serveLab(rows);
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });

      const { user } = renderList();
      const table = await tableOf();
      await settled(table);

      await user.click(kebabOf(rowOf('wheels')) as HTMLElement);
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() =>
        expect(screen.queryByText('wheels', { selector: 'a' })).toBeNull(),
      );
      expect(screen.getByText('galaxy', { selector: 'a' })).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  },
);
