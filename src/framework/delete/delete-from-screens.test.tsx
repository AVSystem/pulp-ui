import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useNavigate, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import {
  API,
  DISTRIBUTIONS,
  REPOSITORIES,
  idOf,
  serveDeleteLab,
} from 'src/test-utils/delete-lab';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type IRepository,
  distribution,
  listOf,
  page,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  role,
  roleAssignment,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
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

// The repositories as the lists and the details read them, the distributions
// that serve them, and the deletes, which take the repository out of the list.
function serveScreens(
  repositories: IRepository[],
  distributions: IDistribution[] = [],
) {
  const rows = [...repositories];
  const sent = serveDeleteLab({ distributions, runningReads: 0 });
  const listing = pluginListHandler('file', 'repository', rows, {
    pageSize: 1000,
  });
  server.use(
    listing.handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/remotes/`, [], { pageSize: 1000, projected: projectedBy })
      .handler,
    // the roles an account that holds permissions on single objects is read
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    http.delete(`*${REPOSITORIES}:id/`, ({ request, params }) => {
      const path = new URL(request.url).pathname;
      sent.deletes.push(path);
      const at = rows.findIndex(({ pulp_href }) => pulp_href === path);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      return HttpResponse.json(
        { task: `${API}/tasks/${params.id}/` },
        { status: 202 },
      );
    }),
  );
  return { ...sent, listQueries: listing.queries };
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

const rowOf = (name: string) =>
  screen.getByRole('link', { name }).closest('tr') as HTMLElement;

async function openRowDelete(
  user: ReturnType<typeof renderAt>['user'],
  name: string,
) {
  await screen.findByRole('grid', { name: 'Repositories' });
  await user.click(
    await within(rowOf(name)).findByRole('button', { name: /actions|kebab/i }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
}

const confirm = async () =>
  within(await screen.findByRole('dialog')).getByRole('button', {
    name: /^Delete/,
  });

const location = () => screen.getByTestId('location').textContent;

describe(
  'Integration: deleting a repository from the list',
  { tags: ['integration'] },
  () => {
    it('offers Delete on the row of a user who holds the delete permission, and not to one who only holds the change permission', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001' }),
        pluginRepository('file', { name: 'repo-0002' }),
      ];
      serveScreens(repositories);
      serveAccount({ isStaff: false, own: [['file.change_filerepository']] });

      const { user } = renderAt('/file/repositories');
      await screen.findByRole('grid', { name: 'Repositories' });
      await user.click(
        await within(rowOf('repo-0001')).findByRole('button', {
          name: /actions|kebab/i,
        }),
      );

      expect(
        await screen.findByRole('menuitem', { name: 'Edit' }),
      ).toBeVisible();
      expect(screen.queryByRole('menuitem', { name: 'Delete' })).toBeNull();
    });

    it('offers Delete on the rows the user holds the delete role on, found in the roles on single objects', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001' }),
        pluginRepository('file', { name: 'repo-0002' }),
      ];
      serveScreens(repositories);
      serveAccount({ isStaff: false });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', repositories[1].pulp_href)],
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
      await screen.findByRole('grid', { name: 'Repositories' });

      await waitFor(() =>
        expect(
          within(rowOf('repo-0002')).queryByRole('button', {
            name: /actions|kebab/i,
          }),
        ).not.toBeNull(),
      );
      expect(
        within(rowOf('repo-0001')).queryByRole('button', {
          name: /actions|kebab/i,
        }),
      ).toBeNull();
      await user.click(
        within(rowOf('repo-0002')).getByRole('button', {
          name: /actions|kebab/i,
        }),
      );
      expect(
        await screen.findByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    });

    it('lists the distributions that go with the repository, deletes them and then the repository, shows what was removed on the list and reads the rows again', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001' }),
        pluginRepository('file', { name: 'repo-0002' }),
      ];
      const served = distribution({
        base_path: 'served-by-one',
        name: 'served-by-one',
        repository: repositories[0].pulp_href,
      });
      const sent = serveScreens(repositories, [served]);

      const { user } = renderAt('/file/repositories');
      await openRowDelete(user, 'repo-0001');

      const dialog = await screen.findByRole('dialog');
      expect(await within(dialog).findByText('served-by-one')).toBeVisible();
      expect(sent.deletes).toStrictEqual([]);

      await user.click(await confirm());

      expect(
        await screen.findByText('Removed repository repo-0001'),
      ).toBeVisible();
      expect(
        screen.getByText('Removed distributions: served-by-one'),
      ).toBeVisible();
      expect(sent.deletes).toStrictEqual([
        served.pulp_href,
        repositories[0].pulp_href,
      ]);
      expect(screen.queryByRole('dialog')).toBeNull();
      await waitFor(() =>
        expect(screen.queryByRole('link', { name: 'repo-0001' })).toBeNull(),
      );
      expect(screen.getByRole('link', { name: 'repo-0002' })).toBeVisible();
      expect(location()).toBe('/file/repositories');
    });

    it('keeps the dialog open with the report when a distribution is refused, and leaves the row where it is', async () => {
      const repositories = [pluginRepository('file', { name: 'repo-0001' })];
      const refused = distribution({
        base_path: 'refused-one',
        name: 'refused-one',
        repository: repositories[0].pulp_href,
      });
      const sent = serveScreens(repositories, [refused]);
      server.use(
        http.delete(`*${DISTRIBUTIONS}:id/`, ({ request }) => {
          sent.deletes.push(new URL(request.url).pathname);
          return HttpResponse.json({ detail: 'Not for you.' }, { status: 403 });
        }),
      );

      const { user } = renderAt('/file/repositories');
      await openRowDelete(user, 'repo-0001');
      await user.click(await confirm());

      expect(
        await screen.findByText(
          'The repository was kept because not every distribution was removed.',
        ),
      ).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(sent.deletes).toStrictEqual([refused.pulp_href]);
    });

    it('shows the result on the next screen, sends nothing to navigate and does not read the list again, when the list is left while the delete runs', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001' }),
        pluginRepository('file', { name: 'other' }),
      ];
      const served = distribution({
        base_path: 'served-by-one',
        name: 'served-by-one',
        repository: repositories[0].pulp_href,
      });
      const sent = serveScreens(repositories, [served]);
      // reads of a page of the list, not of one repository by its name
      const pageReads = () =>
        sent.listQueries.filter((query) => !query.has('name')).length;
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.get(`*${API}/tasks/:id/`, async ({ params }) => {
          await gate;
          return HttpResponse.json({
            pulp_href: `${API}/tasks/${params.id}/`,
            name: 'delete',
            state: 'completed',
          });
        }),
      );

      const { user } = renderAt('/file/repositories');
      await openRowDelete(user, 'repo-0001');
      await user.click(await confirm());
      await waitFor(() => expect(sent.deletes).toHaveLength(1));

      // the user moves on to another screen while the tasks are running
      await user.click(
        screen.getByRole('button', {
          name: 'Leave for another screen',
          hidden: true,
        }),
      );
      await screen.findByRole('heading', { name: 'other' });
      expect(location()).toBe('/file/repositories/other/');
      const listReads = pageReads();

      await act(async () => release());

      expect(
        await screen.findByText('Removed repository repo-0001'),
      ).toBeVisible();
      expect(sent.deletes).toStrictEqual([
        served.pulp_href,
        repositories[0].pulp_href,
      ]);
      // nothing navigated: the user is where they went
      expect(location()).toBe('/file/repositories/other/');
      expect(screen.queryByRole('dialog')).toBeNull();
      // and the list that was left was not read again by the delete
      expect(pageReads()).toBe(listReads);
    });

    it('queues the report of a kept repository for the next screen when the list is left while the delete runs', async () => {
      const repositories = [
        pluginRepository('file', { name: 'repo-0001' }),
        pluginRepository('file', { name: 'other' }),
      ];
      const refused = distribution({
        base_path: 'refused-one',
        name: 'refused-one',
        repository: repositories[0].pulp_href,
      });
      const sent = serveScreens(repositories, [refused]);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      server.use(
        http.delete(`*${DISTRIBUTIONS}:id/`, async ({ request }) => {
          sent.deletes.push(new URL(request.url).pathname);
          await gate;
          return HttpResponse.json({ detail: 'Not for you.' }, { status: 403 });
        }),
      );

      const { user } = renderAt('/file/repositories');
      await openRowDelete(user, 'repo-0001');
      await user.click(await confirm());
      await waitFor(() => expect(sent.deletes).toHaveLength(1));
      await user.click(
        screen.getByRole('button', {
          name: 'Leave for another screen',
          hidden: true,
        }),
      );
      await screen.findByRole('heading', { name: 'other' });

      await act(async () => release());

      expect(
        await screen.findByText(
          'The repository was kept because not every distribution was removed.',
        ),
      ).toBeVisible();
      expect(screen.getByText('Repository: repo-0001')).toBeVisible();
      expect(screen.getByText(/refused-one/)).toBeVisible();
      expect(location()).toBe('/file/repositories/other/');
    });
  },
);

describe(
  'Integration: deleting a repository from its detail',
  { tags: ['integration'] },
  () => {
    it('offers Delete next to Edit to a user who may delete, and only Edit to one who may only change', async () => {
      serveScreens([pluginRepository('file', { name: 'tools' })]);
      serveAccount({ isStaff: false, own: [['file.change_filerepository']] });

      renderAt('/file/repositories/tools/');

      expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('offers no Delete to a user who may only read', async () => {
      serveScreens([pluginRepository('file', { name: 'tools' })]);
      serveAccount({ isStaff: false, own: [] });

      renderAt('/file/repositories/tools/');

      await screen.findByRole('heading', { name: 'tools' });
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('goes to the list with the result once the repository is gone', async () => {
      const tools = pluginRepository('file', { name: 'tools' });
      const served = distribution({
        base_path: 'tools-site',
        name: 'tools-site',
        repository: tools.pulp_href,
      });
      const sent = serveScreens([tools], [served]);

      const { user } = renderAt('/file/repositories/tools/');
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      expect(await screen.findByText('tools-site')).toBeVisible();
      await user.click(await confirm());

      await waitFor(() => expect(location()).toBe('/file/repositories/'));
      expect(await screen.findByText('Removed repository tools')).toBeVisible();
      expect(sent.deletes).toStrictEqual([served.pulp_href, tools.pulp_href]);
    });

    it('stays on the detail with the report when the repository is kept', async () => {
      const tools = pluginRepository('file', { name: 'tools' });
      serveScreens([tools]);
      server.use(
        http.delete(`*${REPOSITORIES}:id/`, () =>
          HttpResponse.json({ detail: 'In use.' }, { status: 403 }),
        ),
      );

      const { user } = renderAt('/file/repositories/tools/');
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      await screen.findByText(/No distribution serves this repository/);
      await user.click(await confirm());

      expect(
        await screen.findByText('The repository was not removed.'),
      ).toBeVisible();
      expect(location()).toBe('/file/repositories/tools/');
      expect(idOf(tools.pulp_href)).toBeTruthy();
    });
  },
);
