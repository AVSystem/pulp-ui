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
import { frameworkCoreRoutes, frameworkRoutes } from './routes';

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
  it('builds the repository routes of a plugin, the list, detail, edit and create routes of its remotes and the detail route of its distributions, each behind the plugin gate', () => {
    const routes = frameworkRoutes([FILE]);

    expect(routes.map(({ path }) => path)).toEqual([
      '/file/repositories',
      '/file/repositories/:name',
      '/file/repositories/:name/versions',
      '/file/repositories/:name/versions/:number',
      '/file/repositories/:name/distributions',
      '/file/repositories/:name/publications',
      '/file/repositories/:name/content',
      '/file/repositories/:name/edit',
      '/file/repository/new',
      '/file/content',
      '/file/remotes',
      '/file/remotes/:name',
      '/file/remotes/:name/edit',
      '/file/remote/new',
      '/file/distributions/:name',
      '/file/distributions/:name/edit',
      '/file/distribution/new',
    ]);
    expect(new Set(routes.map(({ plugin }) => plugin))).toEqual(
      new Set(['file']),
    );
  });

  it('builds no route for a plugin that is not on the framework', () => {
    expect(frameworkRoutes([])).toEqual([]);
  });

  it('builds no repository or remote route for a plugin whose manifest lists neither, so its own screens keep their addresses', () => {
    const distributionOnly = PLUGIN_MANIFESTS.filter(
      ({ resources }) =>
        !resources.includes('repository') && !resources.includes('remote'),
    );

    expect(distributionOnly.map(({ plugin }) => plugin)).toEqual([
      'maven',
      'npm',
      'ansible',
      'container',
    ]);
    expect(frameworkRoutes(distributionOnly).map(({ path }) => path)).toEqual([
      '/maven/distributions/:name',
      '/maven/distributions/:name/edit',
      '/maven/distribution/new',
      '/npm/distributions/:name',
      '/npm/distributions/:name/edit',
      '/npm/distribution/new',
      '/ansible/distributions/:name',
      '/ansible/distributions/:name/edit',
      '/ansible/distribution/new',
      '/container/distributions/:name',
      '/container/distributions/:name/edit',
      '/container/distribution/new',
    ]);
  });

  it('routes the distribution detail, edit and create form of every plugin that has distributions, at their published addresses', () => {
    const paths = frameworkRoutes(PLUGIN_MANIFESTS).map(({ path }) => path);

    for (const { plugin } of PLUGIN_MANIFESTS) {
      expect(paths).toContain(`/${plugin}/distributions/:name`);
      expect(paths).toContain(`/${plugin}/distributions/:name/edit`);
      expect(paths).toContain(`/${plugin}/distribution/new`);
    }
  });

  it('builds the repository routes of a plugin whose manifest lists only the repository', () => {
    const paths = frameworkRoutes([{ ...FILE, resources: ['repository'] }]).map(
      ({ path }) => path,
    );

    expect(paths).toContain('/file/repositories');
    expect(paths.some((path) => path.startsWith('/file/remote'))).toBe(false);
  });

  it('builds the content tab route', () => {
    const paths = frameworkRoutes(PLUGIN_MANIFESTS).map(({ path }) => path);

    expect(paths).toContain('/file/repositories/:name/content');
  });

  it('builds the publications tab route', () => {
    const paths = frameworkRoutes(PLUGIN_MANIFESTS).map(({ path }) => path);

    expect(paths).toContain('/file/repositories/:name/publications');
  });

  it('builds the one route that belongs to no plugin, without a plugin gate', () => {
    const routes = frameworkCoreRoutes();

    expect(routes.map(({ path }) => path)).toEqual(['/distributions']);
    expect(routes[0]).not.toHaveProperty('plugin');
  });

  it('refuses a plugin that has no descriptor yet instead of routing it to nothing', () => {
    const unknown = {
      ...FILE,
      plugin: 'zzz' as never,
      onFramework: true,
    } satisfies PluginManifest;

    expect(() => frameworkRoutes([unknown])).toThrow(/descriptor/);
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
      const python: PluginManifest = {
        ...(PLUGIN_MANIFESTS.find(
          ({ plugin }) => plugin === 'python',
        ) as PluginManifest),
        onFramework: true,
      };
      const served = listOf(
        `${API}/repositories/python/python/`,
        [repository({ name: 'repo-1' })],
        { pageSize: 1000 },
      );
      server.use(served.handler);

      renderWithProviders(<Routed manifests={[python]} />, {
        route: '/python/repositories/repo-1/publications',
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
