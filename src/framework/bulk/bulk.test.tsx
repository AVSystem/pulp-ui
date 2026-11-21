import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useNavigate, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { taskHref } from 'src/entities/core/task/href';
import {
  API,
  DISTRIBUTIONS,
  REPOSITORIES,
  serveDeleteLab,
} from 'src/test-utils/delete-lab';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type IRemote,
  type IRepository,
  distribution,
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  projectedBy,
  role,
  roleAssignment,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { serveSyncLab } from 'src/test-utils/sync-lab';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

// A button that moves to another screen, the way a click on the menu does.
function Leave({ to }: { to: string }) {
  const navigate = useNavigate();

  return <button onClick={() => navigate(to)}>Leave for another screen</button>;
}

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      <Leave to='/file/repositories/other/' />
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

const permissionServers: { stop: () => void }[] = [];

function serveAccount(setup: Parameters<typeof servePermissions>[0]) {
  const served = servePermissions({ id: 7, ...setup });
  permissionServers.push(served);
  return served;
}

beforeEach(() => {
  serveAccount({ isStaff: true });
});

afterEach(() => {
  for (const served of permissionServers.splice(0)) {
    served.stop();
  }
});

// The repositories as the list reads them, the distributions that serve them,
// and the deletes, which take the repository out of the list and are counted
// while they are in flight: a delete is in flight from its request until the
// task it started has been read.
function serveScreens(
  repositories: IRepository[],
  {
    distributions = [],
    refused = [],
  }: { distributions?: IDistribution[]; refused?: IDistribution[] } = {},
) {
  const rows = [...repositories];
  const sent = serveDeleteLab({ distributions, refused, runningReads: 0 });
  const listing = pluginListHandler('file', 'repository', rows, {
    pageSize: 1000,
  });
  const active = new Set<string>();
  let most = 0;
  const requests: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API)) {
      requests.push(`${request.method} ${url.pathname}${url.search}`);
    }
  };
  server.events.on('request:start', onStart);

  server.use(
    listing.handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/remotes/`, [], { pageSize: 1000, projected: projectedBy })
      .handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    http.delete(`*${REPOSITORIES}:id/`, async ({ request, params }) => {
      const path = new URL(request.url).pathname;
      sent.deletes.push(path);
      active.add(String(params.id));
      most = Math.max(most, active.size);
      await new Promise((resolve) => setTimeout(resolve, 8));
      const at = rows.findIndex(({ pulp_href }) => pulp_href === path);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      return HttpResponse.json(
        { task: taskHref(String(params.id)) },
        { status: 202 },
      );
    }),
  );
  // the read of a repository delete's task ends the delete; every other task
  // is answered by the lab
  server.use(
    http.get(`*${API}/tasks/:id/`, ({ params }) => {
      const id = String(params.id);
      if (!active.has(id)) {
        return undefined;
      }
      active.delete(id);
      return HttpResponse.json({
        pulp_href: taskHref(id),
        name: 'delete',
        state: 'completed',
      });
    }),
  );

  return {
    ...sent,
    listQueries: listing.queries,
    requests,
    mostInFlight: () => most,
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

function renderAt(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

type Rendered = ReturnType<typeof renderAt>;

const named = (count: number) =>
  Array.from({ length: count }, (_, n) =>
    pluginRepository('file', {
      name: `repo-${String(n + 1).padStart(4, '0')}`,
    }),
  );

const tableOf = () => screen.findByRole('grid', { name: 'Repositories' });

const boxOf = (name: string) =>
  screen.findByRole('checkbox', { name: `Select ${name}` });

const selectAllBox = () =>
  screen.findByRole('checkbox', {
    name: 'Select all repositories on this page',
  });

const location = () => screen.getByTestId('location').textContent;

async function chooseBulk(user: Rendered['user'], action: string) {
  await user.click(await screen.findByRole('button', { name: 'Bulk actions' }));
  await user.click(await screen.findByRole('menuitem', { name: action }));
  return screen.findByRole('dialog');
}

const confirmButton = (dialog: HTMLElement, name: string | RegExp) =>
  within(dialog).getByRole('button', { name });

// The Close button of the dialog's footer: the one that stays disabled while
// the work runs (the cross in the header is absent then).
const closeButton = (dialog: HTMLElement) =>
  within(dialog)
    .getAllByRole('button', { name: /^Close/ })
    .at(-1) as HTMLElement;

// Waits until the work has ended: the footer button can close the dialog.
const finished = (dialog: HTMLElement) =>
  waitFor(() => expect(closeButton(dialog)).toBeEnabled(), { timeout: 10_000 });

describe(
  'Integration: selecting rows of the repository list',
  { tags: ['integration'] },
  () => {
    it('ticks rows one by one and all rows of the page at once, and counts them', async () => {
      serveScreens(named(5));
      const { user } = renderAt('/file/repositories');
      await tableOf();

      expect(screen.getByText('No rows selected')).toBeVisible();
      await user.click(await boxOf('repo-0002'));
      expect(screen.getByText('1 row selected')).toBeVisible();
      await user.click(await boxOf('repo-0004'));
      expect(screen.getByText('2 rows selected')).toBeVisible();

      await user.click(await selectAllBox());
      expect(screen.getByText('5 rows selected')).toBeVisible();
      expect(await selectAllBox()).toBeChecked();

      await user.click(await selectAllBox());
      expect(screen.getByText('No rows selected')).toBeVisible();
      expect(await boxOf('repo-0002')).not.toBeChecked();
    });

    it('starts again from nothing when the sort, the page or a filter changes', async () => {
      serveScreens(named(60));
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await boxOf('repo-0003'));
      await user.click(await boxOf('repo-0004'));
      expect(screen.getByText('2 rows selected')).toBeVisible();

      // another order
      await user.click(
        document.querySelector('[data-cy="sort_name"]') as HTMLElement,
      );
      await waitFor(() => expect(location()).toContain('sort='));
      await tableOf();
      expect(await screen.findByText('No rows selected')).toBeVisible();

      // another page
      await user.click(await boxOf('repo-0060'));
      expect(screen.getByText('1 row selected')).toBeVisible();
      await user.click(
        screen.getAllByRole('button', { name: /next page/i })[0] as HTMLElement,
      );
      await waitFor(() => expect(location()).toContain('page=2'));
      expect(await screen.findByText('No rows selected')).toBeVisible();

      // and nothing of the first page comes back with it
      await user.click(
        screen.getAllByRole('button', {
          name: /previous page/i,
        })[0] as HTMLElement,
      );
      await waitFor(() => expect(location()).not.toContain('page=2'));
      expect(await screen.findByText('No rows selected')).toBeVisible();
    });

    it('offers neither check boxes nor bulk actions to a user who may do nothing on the rows', async () => {
      serveScreens(named(3));
      serveAccount({ isStaff: false });
      renderAt('/file/repositories');
      await tableOf();

      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Bulk actions' })).toBeNull();
    });

    it('asks the server for the remote and for what the sync options read, which the row actions decide on', async () => {
      const lab = serveScreens(named(2));
      renderAt('/file/repositories');
      await tableOf();

      const query = lab.listQueries[0] as URLSearchParams;
      const fields = query.getAll('fields').flatMap((f) => f.split(','));
      expect(fields).toEqual(
        expect.arrayContaining(['remote', 'pulp_labels', 'autopublish']),
      );
    });
  },
);

describe(
  'Integration: deleting selected repositories',
  { tags: ['integration'] },
  () => {
    it('lists the selected names and the distributions that go with them, and sends nothing before the user confirms', async () => {
      const repositories = named(3);
      const served = distribution({
        base_path: 'served-by-two',
        name: 'served-by-two',
        repository: (repositories[1] as IRepository).pulp_href,
      });
      const lab = serveScreens(repositories, { distributions: [served] });
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await boxOf('repo-0001'));
      await user.click(await boxOf('repo-0002'));
      const before = lab.requests.length;
      const dialog = await chooseBulk(user, 'Delete');

      expect(
        within(dialog).getByText('Delete selected repositories?'),
      ).toBeVisible();
      expect(within(dialog).getByText('repo-0001')).toBeVisible();
      expect(within(dialog).getByText('repo-0002')).toBeVisible();
      expect(within(dialog).queryByText('repo-0003')).toBeNull();
      expect(
        within(dialog).getByText(
          /Distributions deleted with it: served-by-two/,
        ),
      ).toBeVisible();
      expect(lab.deletes).toStrictEqual([]);
      expect(
        lab.requests.slice(before).filter((r) => !r.startsWith('GET ')),
      ).toStrictEqual([]);
      lab.stop();
    });

    it('lists the rows the user may not delete as not permitted and sends nothing for them', async () => {
      const repositories = named(3);
      const lab = serveScreens(repositories);
      serveAccount({ isStaff: false });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', (repositories[1] as IRepository).pulp_href)],
          {
            pageSize: 1000,
            matching: (row, query) =>
              query.get('content_object') !== 'null' ||
              row.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(
            page([
              role({
                name: 'owner',
                permissions: ['file.delete_filerepository'],
              }),
            ]),
          ),
        ),
      );
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await boxOf('repo-0001'));
      await user.click(await boxOf('repo-0002'));
      const dialog = await chooseBulk(user, 'Delete');

      expect(within(dialog).getByText('Selected')).toBeVisible();
      expect(within(dialog).getByText('Not permitted')).toBeVisible();
      const lists = within(dialog).getAllByRole('region');
      expect(
        within(lists[0] as HTMLElement).getByText('repo-0002'),
      ).toBeVisible();
      expect(
        within(lists[1] as HTMLElement).getByText('repo-0001'),
      ).toBeVisible();

      await user.click(confirmButton(dialog, 'Delete'));
      await finished(dialog);
      expect(lab.deletes).toStrictEqual([
        (repositories[1] as IRepository).pulp_href,
      ]);
    });

    it('deletes with at most four in flight and shows one result per selected name and a summary on the list', async () => {
      const repositories = named(12);
      const lab = serveScreens(repositories);
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Delete');
      await user.click(confirmButton(dialog, 'Delete'));

      await finished(dialog);
      expect(lab.deletes).toHaveLength(12);
      expect(lab.mostInFlight()).toBeLessThanOrEqual(4);
      expect(lab.mostInFlight()).toBeGreaterThan(1);

      const results = within(dialog).getByRole('grid', { name: 'Results' });
      for (const { name } of repositories) {
        expect(within(results).getByText(name)).toBeVisible();
      }
      expect(within(results).getAllByText('Succeeded')).toHaveLength(12);
      // the table stays until the dialog is closed, and the list says it too
      expect(
        screen.getByText('Deleting the selected repositories finished'),
      ).toBeVisible();
      expect(screen.getAllByText('12 succeeded').length).toBeGreaterThan(0);

      await user.click(closeButton(dialog));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // the list reads again once the dialog is closed, and nothing is left
      expect(await screen.findByText('No repositories yet')).toBeVisible();
    });

    it('keeps a repository whose distribution was refused, naming the distribution and the reason, and deletes the others', async () => {
      const repositories = named(3);
      const refused = distribution({
        base_path: 'refused-one',
        name: 'refused-one',
        repository: (repositories[1] as IRepository).pulp_href,
      });
      const lab = serveScreens(repositories, {
        distributions: [refused],
        refused: [refused],
      });
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Delete');
      await user.click(confirmButton(dialog, 'Delete'));

      await finished(dialog);
      const results = within(dialog).getByRole('grid', { name: 'Results' });
      expect(within(results).getAllByText('Succeeded')).toHaveLength(2);
      expect(within(results).getAllByText('Failed')).toHaveLength(1);
      const failed = within(results)
        .getByText('repo-0002')
        .closest('tr') as HTMLElement;
      expect(
        within(failed).getByText(/The repository was kept\./),
      ).toBeVisible();
      expect(within(failed).getByText(/refused-one/)).toBeVisible();
      expect(lab.deletes).not.toContain(
        (repositories[1] as IRepository).pulp_href,
      );
    });

    it('queues the summary for the screen the user is on when the list is left while the deletes run', async () => {
      const repositories = [
        ...named(3),
        pluginRepository('file', { name: 'other' }),
      ];
      serveScreens(repositories);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${API}/tasks/:id/`, async ({ params }) => {
          await gate;
          return HttpResponse.json({
            pulp_href: taskHref(String(params.id)),
            name: 'delete',
            state: 'completed',
          });
        }),
      );
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await boxOf('repo-0001'));
      await user.click(await boxOf('repo-0002'));
      const dialog = await chooseBulk(user, 'Delete');
      await user.click(confirmButton(dialog, 'Delete'));
      // the dialog cannot be closed while the work runs
      expect(closeButton(dialog)).toBeDisabled();

      await user.click(
        screen.getByRole('button', {
          name: 'Leave for another screen',
          hidden: true,
        }),
      );
      await screen.findByRole('heading', { name: 'other' });
      await act(async () => release());

      expect(
        await screen.findByText('Deleting the selected repositories finished'),
      ).toBeVisible();
      expect(screen.getByText('2 succeeded')).toBeVisible();
      expect(location()).toBe('/file/repositories/other/');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('takes one dialog and no request but the list own reads to select 500 rows and open the confirmation', async () => {
      const lab = serveScreens(named(500));
      const { user } = renderAt('/file/repositories?page_size=500');
      const table = await tableOf();
      await waitFor(() =>
        expect(table.querySelectorAll('tbody tr')).toHaveLength(500),
      );

      await user.click(await selectAllBox());
      expect(screen.getByText('500 rows selected')).toBeVisible();
      const before = lab.requests.length;
      const dialog = await chooseBulk(user, 'Delete');

      expect(within(dialog).getAllByRole('listitem')).toHaveLength(500);
      expect(lab.requests.length).toBe(before);
      expect(lab.deletes).toStrictEqual([]);
      lab.stop();
    }, 30_000);

    it('does not offer the delete while the distributions cannot be listed', async () => {
      const repositories = named(2);
      const lab = serveScreens(repositories);
      server.use(
        http.get(`*${DISTRIBUTIONS}`, () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Delete');

      expect(
        await within(dialog).findByText(
          'The distributions could not be listed, so nothing can be deleted.',
        ),
      ).toBeVisible();
      expect(confirmButton(dialog, 'Delete')).toBeDisabled();
      expect(lab.deletes).toStrictEqual([]);
    });
  },
);

const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`;

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

// The label requests of a repository or remote, answered as the server does.
// `refuse` answers a request with an error for the objects it names.
function serveLabels(
  kind: 'repositories' | 'remotes',
  refuse: (
    path: string,
    action: 'set' | 'unset',
  ) => Response | undefined = () => undefined,
) {
  const sent: Sent[] = [];
  const answer =
    (action: 'set' | 'unset') =>
    async ({ request }: { request: Request }) => {
      const path = new URL(request.url).pathname;
      const body = (await request.json()) as Record<string, unknown>;
      sent.push({ method: request.method, path, body });
      return refuse(path, action) ?? HttpResponse.json(body);
    };
  server.use(
    http.post(`*${API}/${kind}/file/file/:id/set_label/`, answer('set')),
    http.post(`*${API}/${kind}/file/file/:id/unset_label/`, answer('unset')),
  );
  return sent;
}

const resultOf = (dialog: HTMLElement, name: string) =>
  within(within(dialog).getByRole('grid', { name: 'Results' }))
    .getByText(name)
    .closest('tr') as HTMLElement;

describe(
  'Integration: syncing selected repositories',
  { tags: ['integration'] },
  () => {
    it('starts one sync for every selected repository with a remote, with the options chosen once, and skips the one without a remote', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001', remote: REMOTE }),
        pluginRepository('file', { name: 'repo-0002', remote: null }),
        {
          ...pluginRepository('file', { name: 'repo-0003', remote: REMOTE }),
          autopublish: true,
        },
      ];
      serveScreens(repositories);
      const lab = serveSyncLab({ repository: repositories[0] as IRepository });
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Sync');

      // what the dialog says about the rows before anything is sent
      expect(
        within(dialog).getByText('Sync selected repositories'),
      ).toBeVisible();
      expect(
        within(dialog).getByText(/Has no remote, so it is skipped/),
      ).toBeVisible();
      expect(
        within(dialog).getByText(
          /Mirroring cannot be combined with autopublish/,
        ),
      ).toBeVisible();
      expect(lab.syncs).toStrictEqual([]);

      // the options are chosen once for every row
      await user.click(
        within(dialog).getByRole('switch', {
          name: /Only perform the sync if changes are reported/,
        }),
      );
      await user.click(confirmButton(dialog, 'Sync'));
      await finished(dialog);

      expect(lab.syncs).toHaveLength(2);
      const bodyOf = (index: number) =>
        lab.syncs.find(
          ({ path }) =>
            path === `${(repositories[index] as IRepository).pulp_href}sync/`,
        )?.body;
      expect(bodyOf(0)).toEqual({
        remote: REMOTE,
        mirror: true,
        optimize: false,
      });
      // a repository that publishes by itself is never asked to mirror
      expect(bodyOf(2)).toEqual({
        remote: REMOTE,
        mirror: false,
        optimize: false,
      });

      // one result per row: started with a link to its task, or skipped
      for (const name of ['repo-0001', 'repo-0003']) {
        const row = resultOf(dialog, name);
        expect(within(row).getByText('Started')).toBeVisible();
        expect(
          within(row).getByRole('link', { name: 'View the task' }),
        ).toHaveAttribute('href', expect.stringMatching(/\/tasks\//));
      }
      const skipped = resultOf(dialog, 'repo-0002');
      expect(within(skipped).getByText('Skipped')).toBeVisible();
      expect(
        within(skipped).getByText('No remote to sync from.'),
      ).toBeVisible();
      expect(
        screen.getByText('Syncing the selected repositories was requested'),
      ).toBeVisible();
      expect(
        screen.getAllByText('2 started, 1 skipped').length,
      ).toBeGreaterThan(0);
    });

    it('offers no Sync to a user who may not sync, and the other actions they may take', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001', remote: REMOTE }),
      ];
      serveScreens(repositories);
      serveAccount({ isStaff: false, own: [['file.change_filerepository']] });
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await boxOf('repo-0001'));
      await user.click(
        await screen.findByRole('button', { name: 'Bulk actions' }),
      );

      expect(
        await screen.findByRole('menuitem', { name: 'Add label' }),
      ).toBeVisible();
      expect(
        screen.getByRole('menuitem', { name: 'Remove label' }),
      ).toBeVisible();
      expect(screen.queryByRole('menuitem', { name: 'Sync' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    });
  },
);

describe(
  'Integration: changing the labels of selected repositories',
  { tags: ['integration'] },
  () => {
    const labelled = () => [
      pluginRepository('file', {
        name: 'repo-0001',
        pulp_labels: { team: 'docs', tier: null },
      }),
      pluginRepository('file', { name: 'repo-0002', pulp_labels: {} }),
      pluginRepository('file', {
        name: 'repo-0003',
        pulp_labels: { team: 'tools' },
      }),
    ];

    it('sets the label on every selected repository with one request each and shows a result per row', async () => {
      const repositories = labelled();
      serveScreens(repositories);
      const sent = serveLabels('repositories');
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Add label');
      const add = confirmButton(dialog, 'Add label');
      expect(add).toBeDisabled();

      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'env',
      );
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label value' }),
        'prod',
      );
      expect(add).toBeEnabled();
      expect(sent).toStrictEqual([]);
      await user.click(add);
      await finished(dialog);

      expect(sent).toHaveLength(3);
      expect(sent.map(({ path }) => path).sort()).toEqual(
        repositories.map(({ pulp_href }) => `${pulp_href}set_label/`).sort(),
      );
      for (const { body } of sent) {
        expect(body).toEqual({ key: 'env', value: 'prod' });
      }
      expect(
        within(
          within(dialog).getByRole('grid', { name: 'Results' }),
        ).getAllByText('Succeeded'),
      ).toHaveLength(3);
    });

    it('refuses a key or a value the server would refuse before anything is sent', async () => {
      serveScreens(labelled());
      const sent = serveLabels('repositories');
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Add label');
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'bad/key',
      );

      expect(
        within(dialog).getByText(/A label key can contain only letters/),
      ).toBeVisible();
      expect(confirmButton(dialog, 'Add label')).toBeDisabled();

      await user.clear(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
      );
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'good',
      );
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label value' }),
        'no (parentheses)',
      );
      expect(
        within(dialog).getByText('A label value cannot contain parentheses.'),
      ).toBeVisible();
      expect(confirmButton(dialog, 'Add label')).toBeDisabled();
      expect(sent).toStrictEqual([]);
    });

    it('removes the key from the rows that have it, and skips the rows that lack it without a request', async () => {
      const repositories = labelled();
      serveScreens(repositories);
      const sent = serveLabels('repositories');
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Remove label');
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'team',
      );

      // the row that lacks the key says so before the user confirms
      expect(
        within(dialog).getAllByText(
          /Does not have this label, so it is skipped/,
        ),
      ).toHaveLength(1);
      await user.click(confirmButton(dialog, 'Remove label'));
      await finished(dialog);

      expect(sent.map(({ path }) => path).sort()).toEqual(
        [repositories[0], repositories[2]]
          .map((row) => `${(row as IRepository).pulp_href}unset_label/`)
          .sort(),
      );
      for (const { body } of sent) {
        expect(body).toEqual({ key: 'team' });
      }
      const skipped = resultOf(dialog, 'repo-0002');
      expect(within(skipped).getByText('Skipped')).toBeVisible();
      expect(within(skipped).getByText('The label is not set.')).toBeVisible();
      expect(resultOf(dialog, 'repo-0001')).toHaveTextContent('Succeeded');
      expect(
        screen.getAllByText('2 succeeded, 1 skipped').length,
      ).toBeGreaterThan(0);
    });

    it('counts the server saying the label is not set as skipped, not failed, and shows the server reason of a real failure', async () => {
      const repositories = labelled();
      serveScreens(repositories);
      const stale = (repositories[0] as IRepository).pulp_href;
      const broken = (repositories[2] as IRepository).pulp_href;
      serveLabels('repositories', (path) =>
        path === `${stale}unset_label/`
          ? HttpResponse.json(
              { detail: "Label 'team' is not set on the object." },
              { status: 400 },
            )
          : path === `${broken}unset_label/`
            ? HttpResponse.json(
                { detail: 'The object is locked.' },
                { status: 400 },
              )
            : undefined,
      );
      const { user } = renderAt('/file/repositories');
      await tableOf();

      await user.click(await selectAllBox());
      const dialog = await chooseBulk(user, 'Remove label');
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'team',
      );
      await user.click(confirmButton(dialog, 'Remove label'));
      await finished(dialog);

      expect(resultOf(dialog, 'repo-0001')).toHaveTextContent('Skipped');
      const failed = resultOf(dialog, 'repo-0003');
      expect(within(failed).getByText('Failed')).toBeVisible();
      expect(within(failed).getByText(/The object is locked\./)).toBeVisible();
    });
  },
);

// The remotes the list reads, the repositories the used by column and the
// delete confirmation are found from, and the deletes, answered with a task.
function serveRemotes(
  remotes: IRemote[],
  repositories: IRepository[] = [],
  refuse: (path: string) => Response | undefined = () => undefined,
) {
  const deletes: string[] = [];
  server.use(
    pluginListHandler('file', 'remote', remotes, { pageSize: 1000 }).handler,
    pluginListHandler('file', 'repository', repositories, { pageSize: 1000 })
      .handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    taskListHandler([]).handler,
    http.delete(`*${API}/remotes/file/file/:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      deletes.push(path);
      return (
        refuse(path) ??
        HttpResponse.json(
          { task: taskHref(String(params.id)) },
          { status: 202 },
        )
      );
    }),
    http.get(`*${API}/tasks/:id/`, ({ params }) =>
      HttpResponse.json({
        pulp_href: taskHref(String(params.id)),
        name: 'delete',
        state: 'running',
      }),
    ),
  );
  return deletes;
}

describe(
  'Integration: bulk actions on the remote list',
  { tags: ['integration'] },
  () => {
    const remotes = () => [
      pluginRemote('file', { name: 'rm-0001', pulp_labels: { team: 'a' } }),
      pluginRemote('file', { name: 'rm-0002', pulp_labels: {} }),
      pluginRemote('file', { name: 'rm-0003', pulp_labels: { team: 'c' } }),
    ];

    const remoteBox = (name: string) =>
      screen.findByRole('checkbox', { name: `Select ${name}` });

    it('offers delete and the two label actions on remotes, and no sync', async () => {
      serveRemotes(remotes());
      const { user } = renderAt('/file/remotes');
      await screen.findByRole('grid', { name: 'Remotes' });

      await user.click(await remoteBox('rm-0001'));
      await user.click(
        await screen.findByRole('button', { name: 'Bulk actions' }),
      );

      expect(
        await screen.findByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
      expect(screen.getByRole('menuitem', { name: 'Add label' })).toBeVisible();
      expect(
        screen.getByRole('menuitem', { name: 'Remove label' }),
      ).toBeVisible();
      expect(screen.queryByRole('menuitem', { name: 'Sync' })).toBeNull();
    });

    it('names the repositories that use each remote, deletes the selected remotes one request each and links the task of each', async () => {
      const list = remotes();
      const using = pluginRepository('file', {
        name: 'uses-rm-0001',
        remote: (list[0] as IRemote).pulp_href,
      });
      const deletes = serveRemotes(list, [using]);
      const { user } = renderAt('/file/remotes');
      await screen.findByRole('grid', { name: 'Remotes' });

      await user.click(await remoteBox('rm-0001'));
      await user.click(await remoteBox('rm-0003'));
      const dialog = await chooseBulk(user, 'Delete');

      expect(
        within(dialog).getByText('Delete selected remotes?'),
      ).toBeVisible();
      expect(
        await within(dialog).findByText(/Used by uses-rm-0001/),
      ).toBeVisible();
      expect(within(dialog).queryByText('rm-0002')).toBeNull();
      expect(deletes).toStrictEqual([]);

      await user.click(confirmButton(dialog, 'Delete'));
      await finished(dialog);

      expect(deletes.sort()).toEqual(
        [list[0], list[2]].map((row) => (row as IRemote).pulp_href).sort(),
      );
      for (const name of ['rm-0001', 'rm-0003']) {
        const row = resultOf(dialog, name);
        expect(within(row).getByText('Started')).toBeVisible();
        expect(
          within(row).getByRole('link', { name: 'View the task' }),
        ).toBeVisible();
      }
    });

    it('shows the reason of a delete the server refused and starts the others', async () => {
      const list = remotes();
      const refused = (list[1] as IRemote).pulp_href;
      serveRemotes(list, [], (path) =>
        path === refused
          ? HttpResponse.json({ detail: 'In use elsewhere.' }, { status: 400 })
          : undefined,
      );
      const { user } = renderAt('/file/remotes');
      await screen.findByRole('grid', { name: 'Remotes' });

      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Select all remotes on this page',
        }),
      );
      const dialog = await chooseBulk(user, 'Delete');
      await user.click(confirmButton(dialog, 'Delete'));
      await finished(dialog);

      const failed = resultOf(dialog, 'rm-0002');
      expect(within(failed).getByText('Failed')).toBeVisible();
      expect(within(failed).getByText(/In use elsewhere\./)).toBeVisible();
      expect(resultOf(dialog, 'rm-0001')).toHaveTextContent('Started');
      expect(resultOf(dialog, 'rm-0003')).toHaveTextContent('Started');
    });

    it('removes a label from the remotes that have it and skips the others without a request', async () => {
      const list = remotes();
      serveRemotes(list);
      const sent = serveLabels('remotes');
      const { user } = renderAt('/file/remotes');
      await screen.findByRole('grid', { name: 'Remotes' });

      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Select all remotes on this page',
        }),
      );
      const dialog = await chooseBulk(user, 'Remove label');
      await user.type(
        within(dialog).getByRole('textbox', { name: 'Label key' }),
        'team',
      );
      await user.click(confirmButton(dialog, 'Remove label'));
      await finished(dialog);

      expect(sent).toHaveLength(2);
      expect(resultOf(dialog, 'rm-0002')).toHaveTextContent('Skipped');
    });

    it('offers neither check boxes nor bulk actions to a user who may do nothing on the remotes', async () => {
      serveRemotes(remotes());
      serveAccount({ isStaff: false });
      renderAt('/file/remotes');
      await screen.findByRole('grid', { name: 'Remotes' });

      expect(screen.queryByRole('checkbox')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Bulk actions' })).toBeNull();
    });
  },
);
