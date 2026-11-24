import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  corePublicationListHandler,
  distributionListHandler,
  listOf,
  pluginListHandler,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';

const manifestOf = (plugin: string): PluginManifest => ({
  ...(PLUGIN_MANIFESTS.find(
    (manifest) => manifest.plugin === plugin,
  ) as PluginManifest),
  onFramework: true,
});

function Routed({ plugin }: { plugin: string }) {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([manifestOf(plugin)])))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

function renderTab(plugin: 'deb' | 'rpm', name: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed plugin={plugin} />
      </PermissionsKnown>
    </AppContextProvider>,
    { route: `/${plugin}/repositories/${name}/publications` },
  );
}

const rowOf = async (version: number) =>
  (await screen.findByRole('link', { name: String(version) })).closest(
    'tr',
  ) as HTMLElement;

describe(
  'Integration: the Publications tab of deb and rpm',
  { tags: ['integration'] },
  () => {
    it('lists the apt and the verbatim publications of a deb repository, each with its type and the modes of an apt one', async () => {
      const repository = pluginRepository('deb', { name: 'dists' });
      const apt = pluginPublication('deb', {
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/2/`,
        pulp_created: '2024-01-03T00:00:00.000000Z',
        simple: true,
        structured: false,
      });
      const verbatim = {
        pulp_href:
          '/pulp/api/v3/publications/deb/verbatim/00000000-0000-4000-8000-0000000000c1/',
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/1/`,
        pulp_created: '2024-01-02T00:00:00.000000Z',
      };
      server.use(
        pluginListHandler('deb', 'repository', [repository]).handler,
        corePublicationListHandler([apt, verbatim]).handler,
        publicationListHandler('deb', [apt]).handler,
        distributionListHandler('deb', []).handler,
        listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
      );

      renderTab('deb', 'dists');

      const newest = await rowOf(2);
      expect(within(newest).getByText('Apt')).toBeVisible();
      await waitFor(() =>
        expect(within(newest).getByText('Yes')).toBeVisible(),
      );
      expect(within(newest).getByText('No')).toBeVisible();
      const older = await rowOf(1);
      expect(within(older).getByText('Verbatim')).toBeVisible();
    });

    it('deletes a verbatim publication through its own collection', async () => {
      const repository = pluginRepository('deb', { name: 'dists' });
      const verbatim = {
        pulp_href:
          '/pulp/api/v3/publications/deb/verbatim/00000000-0000-4000-8000-0000000000c1/',
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/1/`,
        pulp_created: '2024-01-02T00:00:00.000000Z',
      };
      const deleted: string[] = [];
      server.use(
        pluginListHandler('deb', 'repository', [repository]).handler,
        corePublicationListHandler([verbatim]).handler,
        publicationListHandler('deb', []).handler,
        distributionListHandler('deb', []).handler,
        listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
        http.delete(`*${API}/publications/deb/verbatim/:id/`, ({ request }) => {
          deleted.push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 204 });
        }),
      );

      const { user } = renderTab('deb', 'dists');
      const row = await rowOf(1);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(
        await within(dialog).findByRole('button', { name: 'Delete' }),
      );

      await waitFor(() => expect(deleted).toEqual([verbatim.pulp_href]));
    });

    it('shows the checksum and compression type of an rpm publication', async () => {
      const repository = pluginRepository('rpm', { name: 'packages' });
      const published = pluginPublication('rpm', {
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/1/`,
        checksum_type: 'sha256',
        compression_type: 'gz',
      });
      server.use(
        pluginListHandler('rpm', 'repository', [repository]).handler,
        corePublicationListHandler([published]).handler,
        publicationListHandler('rpm', [published]).handler,
        distributionListHandler('rpm', []).handler,
        listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
      );

      renderTab('rpm', 'packages');

      const row = await rowOf(1);
      await waitFor(() =>
        expect(within(row).getByText('sha256')).toBeVisible(),
      );
      expect(within(row).getByText('gzip')).toBeVisible();
    });
  },
);
