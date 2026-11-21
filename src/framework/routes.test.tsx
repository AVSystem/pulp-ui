import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  listOf,
  publicationListHandler,
  repository,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from './manifest';
import { frameworkRoutes } from './routes';

// The descriptor of a plugin is its own chunk: it is evaluated the first time a
// route of the plugin renders and never before. The counter sees every load.
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('src/descriptors/file/descriptor', async (importOriginal) => {
  loaded.count += 1;
  return importOriginal();
});

const API = '/pulp/api/v3';
const REPOSITORIES = `${API}/repositories/file/file/`;

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

// The routes the application builds from the manifests, inside the gate every
// route of the application passes: session, installed plugin, then the screen.
function Routed({ manifests = [FILE] }: { manifests?: PluginManifest[] }) {
  const { pathname } = useLocation();

  return (
    <AppContextProvider>
      <PermissionsKnown>
        <p data-testid='location'>{pathname}</p>
        {useRoutes(guardRoutes(frameworkRoutes(manifests)))}
      </PermissionsKnown>
    </AppContextProvider>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  loaded.count = 0;
  permissions = servePermissions({ id: 1, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

const serveRepositories = (...rows: ReturnType<typeof repository>[]) => {
  const served = listOf(REPOSITORIES, rows, {
    matching: (row, query) =>
      !query.get('name') || row.name === query.get('name'),
  });
  server.use(
    served.handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
  );
  return served;
};

describe('Unit: frameworkRoutes', { tags: ['unit'] }, () => {
  it('builds the repository routes of a plugin and the list, detail, edit and create routes of its remotes, each behind the plugin gate', () => {
    const routes = frameworkRoutes([FILE]);

    expect(routes.map(({ path }) => path)).toEqual([
      '/file/repositories',
      '/file/repositories/:name',
      '/file/repositories/:name/versions',
      '/file/repositories/:name/versions/:number',
      '/file/repositories/:name/distributions',
      '/file/repositories/:name/packages',
      '/file/repositories/:name/edit',
      '/file/repository/new',
      '/file/remotes',
      '/file/remotes/:name',
      '/file/remotes/:name/edit',
      '/file/remote/new',
    ]);
    expect(new Set(routes.map(({ plugin }) => plugin))).toEqual(
      new Set(['file']),
    );
  });

  it('builds no route for a plugin that is not on the framework', () => {
    expect(frameworkRoutes([])).toEqual([]);
  });

  it('refuses a plugin that has no descriptor yet instead of routing it to nothing', () => {
    const deb = {
      ...FILE,
      plugin: 'deb',
      onFramework: true,
    } satisfies PluginManifest;

    expect(() => frameworkRoutes([deb])).toThrow(/descriptor/);
  });
});

describe(
  'Integration: the repository detail of a plugin on the framework',
  { tags: ['integration'] },
  () => {
    it('loads the descriptor, reads the repository by name once and shows the Details rows', async () => {
      const served = serveRepositories(
        repository({
          name: 'repo-1',
          description: 'Mirror of the manuals',
          retain_repo_versions: 3,
          pulp_labels: { team: 'docs', tier: null },
        }),
        repository({ name: 'repo-2' }),
      );

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-1/' });

      await screen.findByRole('heading', { name: 'repo-1', level: 1 });
      const rows = await screen.findByText('Repository name');
      const details = rows.closest('dl') as HTMLElement;
      expect(within(details).getByText('repo-1')).toBeVisible();
      expect(within(details).getByText('Mirror of the manuals')).toBeVisible();
      expect(within(details).getByText('Retained version count')).toBeVisible();
      expect(within(details).getByText('3')).toBeVisible();
      expect(within(details).getByText('Labels')).toBeVisible();
      expect(within(details).getByText('team: docs')).toBeVisible();
      expect(within(details).getByText('tier')).toBeVisible();

      // one read: the repository by its name, as a value of the name filter
      expect(served.queries).toHaveLength(1);
      expect(served.queries[0]?.get('name')).toBe('repo-1');
      expect(served.queries[0]?.get('limit')).toBe('1');
      expect(loaded.count).toBe(1);
    });

    it('shows the rows that have no value as None and All', async () => {
      serveRepositories(repository({ name: 'repo-1', description: '' }));

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-1/' });

      const term = await screen.findByText('Description');
      const group = term.closest('div') as HTMLElement;
      expect(within(group).getByText('None')).toBeVisible();
      const retained = screen.getByText('Retained version count');
      expect(
        within(retained.closest('div') as HTMLElement).getByText('All'),
      ).toBeVisible();
    });

    it('offers the Details tab and a link back to the repository list', async () => {
      serveRepositories(repository({ name: 'repo-1' }));

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-1/' });

      const details = await screen.findByRole('link', { name: 'Details' });
      expect(details).toHaveAttribute('href', '/file/repositories/repo-1/');
      expect(details).toHaveAttribute('aria-current', 'page');
    });

    it('shows Not Found after one read for a name no repository has', async () => {
      const served = serveRepositories(repository({ name: 'repo-1' }));

      renderWithProviders(<Routed />, { route: '/file/repositories/no-such/' });

      await screen.findByRole('heading', { name: '404 - Page not found' });
      expect(served.queries).toHaveLength(1);
      expect(served.queries[0]?.get('name')).toBe('no-such');
    });

    it('does not take a row of another name for the repository', async () => {
      server.use(
        listOf(REPOSITORIES, [repository({ name: 'repo-1' })]).handler,
      );

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-9/' });

      await screen.findByRole('heading', { name: '404 - Page not found' });
    });

    it('sends a name with a slash to the server as the value of the filter, in one path segment', async () => {
      const served = serveRepositories(repository({ name: 'a/b' }));

      renderWithProviders(<Routed />, { route: '/file/repositories/a%2Fb/' });

      await screen.findByRole('heading', { name: 'a/b', level: 1 });
      expect(served.queries[0]?.get('name')).toBe('a/b');
    });

    it('shows the error state with Retry when the read fails, and reads again on Retry', async () => {
      let answers = 0;
      server.use(
        distributionListHandler('file', []).handler,
        publicationListHandler('file', []).handler,
        http.get(`*${REPOSITORIES}`, ({ request }) => {
          answers += 1;
          if (answers === 1) {
            return HttpResponse.json({ detail: 'Broken.' }, { status: 500 });
          }
          return HttpResponse.json({
            count: 1,
            next: null,
            previous: null,
            results: [
              repository({
                name: new URL(request.url).searchParams.get('name') as string,
              }),
            ],
          });
        }),
      );

      const { user } = renderWithProviders(<Routed />, {
        route: '/file/repositories/repo-1/',
      });

      await screen.findByRole('heading', {
        name: 'Repository could not be displayed.',
      });
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await screen.findByRole('heading', { name: 'repo-1', level: 1 });
      expect(answers).toBe(2);
    });

    it("shows the insufficient permissions page with Pulp's reason when the read is refused", async () => {
      server.use(
        http.get(`*${REPOSITORIES}`, () =>
          HttpResponse.json({ detail: 'No.' }, { status: 403 }),
        ),
      );

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-1/' });

      await screen.findByRole('heading', {
        name: 'Insufficient permissions',
        level: 4,
      });
      expect(screen.getByText('No.')).toBeVisible();
    });

    it('shows Not Found for a tab the plugin does not have, without reading the repository', async () => {
      const served = serveRepositories(repository({ name: 'repo-1' }));

      renderWithProviders(<Routed />, {
        route: '/file/repositories/repo-1/packages',
      });

      await screen.findByRole('heading', { name: '404 - Page not found' });
      expect(served.queries).toHaveLength(0);
    });

    it('shows Not Found for a version number that is not a number', async () => {
      const served = serveRepositories(repository({ name: 'repo-1' }));

      renderWithProviders(<Routed />, {
        route: '/file/repositories/repo-1/versions/abc',
      });

      await screen.findByRole('heading', { name: '404 - Page not found' });
      expect(served.queries).toHaveLength(0);
    });

    it('shows the plugin as not installed, and loads no descriptor, when the server lacks it', async () => {
      const served = serveRepositories(repository({ name: 'repo-1' }));
      server.use(
        http.get('*/pulp/api/v3/status/', () =>
          HttpResponse.json({
            versions: [{ component: 'core', version: '3.0.0' }],
          }),
        ),
      );

      renderWithProviders(<Routed />, { route: '/file/repositories/repo-1/' });

      await screen.findByRole('heading', {
        name: 'Plugin not installed',
        level: 1,
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/file/repositories/repo-1/',
        ),
      );
      expect(loaded.count).toBe(0);
      expect(served.queries).toHaveLength(0);
    });
  },
);
