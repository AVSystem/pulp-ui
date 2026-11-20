import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRepository,
  distributionListHandler,
  listOf,
  page,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { API, serveSyncLab } from 'src/test-utils/sync-lab';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`;
const SYNC = 'file.sync_filerepository';

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
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

// The list of the plugin, with the sync lab answering the tasks of the first
// repository.
function serveScreens(repositories: IRepository[]) {
  const lab = serveSyncLab({ repository: repositories[0] });
  server.use(
    pluginListHandler('file', 'repository', repositories, { pageSize: 1000 })
      .handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    listOf(`${API}/remotes/`, [], { pageSize: 1000, projected: projectedBy })
      .handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return lab;
}

function renderList() {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route: '/file/repositories' },
  );
}

const rowOf = (name: string) =>
  screen.getByRole('link', { name }).closest('tr') as HTMLElement;

async function openMenu(
  user: ReturnType<typeof renderList>['user'],
  name: string,
) {
  await screen.findByRole('grid', { name: 'Repositories' });
  await user.click(
    await within(rowOf(name)).findByRole('button', { name: /actions|kebab/i }),
  );
}

describe(
  'Integration: syncing from the repository list',
  { tags: ['integration'] },
  () => {
    const synced = () =>
      pluginRepository('file', { name: 'repo-0001', remote: REMOTE });
    const plain = () =>
      pluginRepository('file', { name: 'repo-0002', remote: null });

    it('opens the sync dialog from the row, sends one request, closes the dialog, says the sync started and shows the running sync in the last task column', async () => {
      const lab = serveScreens([synced(), plain()]);
      lab.startAs('running');
      const { user } = renderList();

      await openMenu(user, 'repo-0001');
      await user.click(await screen.findByRole('menuitem', { name: 'Sync' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText('Sync repository "repo-0001"'),
      ).toBeVisible();
      expect(lab.syncs).toEqual([]);
      await user.click(within(dialog).getByRole('button', { name: 'Sync' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.syncs).toHaveLength(1);
      expect(lab.syncs[0].body).toEqual({
        remote: REMOTE,
        mirror: true,
        optimize: true,
      });
      expect(
        await screen.findByText('Sync started for repository "repo-0001".'),
      ).toBeVisible();
      await waitFor(() =>
        expect(within(rowOf('repo-0001')).getByText('Running')).toBeVisible(),
      );
    });

    it('offers no Sync on the row of a repository that has no remote', async () => {
      serveScreens([synced(), plain()]);
      const { user } = renderList();

      await openMenu(user, 'repo-0002');

      await screen.findByRole('menuitem', { name: 'Edit' });
      expect(screen.queryByRole('menuitem', { name: 'Sync' })).toBeNull();
    });

    it('offers Sync to a user who holds the sync permission, and not to one who does not', async () => {
      serveAccount({ isStaff: false, own: [[SYNC]] });
      serveScreens([synced()]);
      const { user, unmount } = renderList();

      await openMenu(user, 'repo-0001');
      expect(
        await screen.findByRole('menuitem', { name: 'Sync' }),
      ).toBeVisible();
      unmount();

      serveAccount({ isStaff: false, own: [['file.change_filerepository']] });
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));
      const second = renderList();

      await openMenu(second.user, 'repo-0001');
      await screen.findByRole('menuitem', { name: 'Edit' });
      expect(screen.queryByRole('menuitem', { name: 'Sync' })).toBeNull();
    });

    it('says the repository is already syncing in the dialog, and sends nothing', async () => {
      const lab = serveScreens([synced()]);
      lab.add({ state: 'running' });
      const { user } = renderList();

      await openMenu(user, 'repo-0001');
      await user.click(await screen.findByRole('menuitem', { name: 'Sync' }));

      expect(
        await screen.findByText(
          'A sync of this repository is already running.',
        ),
      ).toBeVisible();
      expect(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Sync',
        }),
      ).toBeDisabled();
      expect(lab.syncs).toEqual([]);
    });
  },
);
