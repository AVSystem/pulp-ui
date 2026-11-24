import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PLUGIN_MANIFESTS, type PluginManifest } from 'src/framework/manifest';
import { frameworkRoutes } from 'src/framework/routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  listOf,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';

// The Content tab of a python repository as a user meets it: routed from the
// manifest, drawn from the python descriptor, and answered by a server that
// cuts every row to the fields a request asks for.

const API = '/pulp/api/v3';
const PACKAGES = `${API}/content/python/packages/`;

const PYTHON: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'python',
  ) as PluginManifest),
  onFramework: true,
};

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkRoutes([PYTHON])))}
    </>
  );
}

function render(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

interface Row {
  pulp_href: string;
  name: string;
  version: string;
  packagetype: string;
  filename: string;
  requires_python: string | null;
  // a field the tab never asks for
  description: string;
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  pulp_href: `${PACKAGES}00000000-0000-4000-8000-${String(n).padStart(12, '0')}/`,
  name: `pkg-${String(n).padStart(3, '0')}`,
  version: `1.${n}`,
  packagetype: 'sdist',
  filename: `pkg-${String(n).padStart(3, '0')}-1.${n}.tar.gz`,
  requires_python: '>=3.9',
  description: 'a long description the tab does not read',
  ...overrides,
});

// The package list of a server: only the rows of the version asked for, the
// `name__contains`, `packagetype` and `requires_python__contains` filters, the
// ordering and the fields cut.
function servePackages(rows: Row[], version: string) {
  return listOf(PACKAGES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      query.get('repository_version') === version &&
      (query.get('name__contains') === null ||
        each.name.includes(query.get('name__contains') as string)) &&
      (query.get('packagetype') === null ||
        each.packagetype === query.get('packagetype')) &&
      (query.get('requires_python__contains') === null ||
        (each.requires_python ?? '').includes(
          query.get('requires_python__contains') as string,
        )),
    ordered: (selected, query) => {
      const ordering = query.get('ordering');
      if (!ordering) {
        return selected;
      }
      const field = ordering.replace(/^-/, '') as keyof Row;
      const sorted = [...selected].sort((a, b) =>
        String(a[field]).localeCompare(String(b[field])),
      );
      return ordering.startsWith('-') ? sorted.reverse() : sorted;
    },
    projected: projectedBy,
  });
}

function serveRepository(
  overrides: Partial<ReturnType<typeof pluginRepository>> = {},
) {
  const repository = pluginRepository('python', {
    name: 'simple',
    ...overrides,
  });
  server.use(
    pluginListHandler('python', 'repository', [repository], {
      pageSize: 1000,
    }).handler,
    pluginListHandler('python', 'remote', [], { pageSize: 1000 }).handler,
    distributionListHandler('python', []).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return repository;
}

const table = () => screen.findByRole('grid', { name: 'Packages' });
const bodyRows = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('row')
    .filter((each) => within(each).queryAllByRole('columnheader').length === 0);
const location = () => screen.getByTestId('location').textContent;

describe(
  'Integration: the Content tab of a python repository',
  { tags: ['integration'] },
  () => {
    it('lists the packages of the latest version with the name, version, type, file and required Python, and asks for nothing else', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [
          row(1, { packagetype: 'bdist_wheel', filename: 'a-1.1-py3.whl' }),
          row(2, { requires_python: null }),
        ],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render('/python/repositories/simple/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim());
      expect(headers).toEqual([
        'Name',
        'Version',
        'Type',
        'File',
        'Requires Python',
      ]);
      const cells = (index: number) =>
        within(bodyRows(grid)[index] as HTMLElement)
          .getAllByRole('cell')
          .map((cell) => cell.textContent);
      expect(cells(0)).toEqual([
        'pkg-001',
        '1.1',
        'bdist_wheel',
        'a-1.1-py3.whl',
        '>=3.9',
      ]);
      // a package that states no Python requirement shows a dash, not a blank
      expect(cells(1)[4]).toBe('---');

      expect(lab.queries).toHaveLength(1);
      const query = lab.queries[0] as URLSearchParams;
      expect(query.get('repository_version')).toBe(
        repository.latest_version_href,
      );
      expect(query.get('limit')).toBe('20');
      expect(query.get('offset')).toBe('0');
      expect(query.get('ordering')).toBe('name');
      expect(query.getAll('fields').sort()).toEqual([
        'filename',
        'name',
        'packagetype',
        'pulp_href',
        'requires_python',
        'version',
      ]);
    });

    it('sends one request for a whole page, never one per row', async () => {
      const repository = serveRepository();
      const rows = Array.from({ length: 20 }, (_, index) => row(index + 1));
      const lab = servePackages(rows, repository.latest_version_href as string);
      const seen: string[] = [];
      server.events.on('request:start', ({ request }) => {
        seen.push(new URL(request.url).pathname);
      });
      server.use(lab.handler);
      render('/python/repositories/simple/content');

      const grid = await table();
      await within(grid).findByText('pkg-020');

      expect(bodyRows(grid)).toHaveLength(20);
      expect(seen.filter((path) => path.includes('/content/'))).toEqual([
        '/pulp/api/v3/content/python/packages/',
      ]);
      server.events.removeAllListeners();
    });

    it('pages by 20 and shows the next page from the address', async () => {
      const repository = serveRepository();
      const rows = Array.from({ length: 45 }, (_, index) => row(index + 1));
      const lab = servePackages(rows, repository.latest_version_href as string);
      server.use(lab.handler);
      const { user } = render('/python/repositories/simple/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');
      expect(bodyRows(grid)).toHaveLength(20);

      await user.click(
        screen.getAllByRole('button', {
          name: 'Go to next page',
        })[0] as HTMLElement,
      );

      await waitFor(() => expect(location()).toMatch(/[?&]page=2/));
      await within(await table()).findByText('pkg-021');
      expect(lab.queries.at(-1)?.get('offset')).toBe('20');
      expect(lab.queries.at(-1)?.get('limit')).toBe('20');
    });

    it('filters by name, package type and required Python, each by the parameter the server takes, and shows what is applied', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [
          row(1, { name: 'django' }),
          row(2, {
            name: 'django-extras',
            packagetype: 'bdist_wheel',
            requires_python: '>=3.10',
          }),
          row(3, { name: 'flask', packagetype: 'bdist_wheel' }),
        ],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render(
        '/python/repositories/simple/content?name__contains=django&packagetype=bdist_wheel&requires_python__contains=3.10',
      );

      const grid = await table();
      await within(grid).findByText('django-extras');

      expect(bodyRows(grid)).toHaveLength(1);
      const query = lab.queries.at(-1) as URLSearchParams;
      expect(query.get('name__contains')).toBe('django');
      expect(query.get('packagetype')).toBe('bdist_wheel');
      expect(query.get('requires_python__contains')).toBe('3.10');
      const applied = (name: string) =>
        within(screen.getByRole('list', { name })).getAllByRole('listitem');
      expect(applied('Package name').map((item) => item.textContent)).toEqual([
        'django',
      ]);
      expect(applied('Package type').map((item) => item.textContent)).toEqual([
        'bdist_wheel',
      ]);
      expect(
        applied('Requires Python').map((item) => item.textContent),
      ).toEqual(['3.10']);
    });

    it('applies a name typed into the filter and goes back to the first page', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [row(1, { name: 'django' }), row(2, { name: 'flask' })],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      const { user } = render('/python/repositories/simple/content?page=1');

      await within(await table()).findByText('flask');
      await user.type(
        screen.getByRole('textbox', { name: 'name__contains' }),
        'fl',
      );
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(location()).toMatch(/name__contains=fl/));
      await waitFor(() =>
        expect(lab.queries.at(-1)?.get('name__contains')).toBe('fl'),
      );
      const grid = await table();
      await waitFor(() => expect(bodyRows(grid)).toHaveLength(1));
      expect(within(grid).queryByText('django')).toBeNull();
    });

    it('sorts by name from the header and ignores a sort the server is not asked for', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [row(1, { name: 'a' }), row(2, { name: 'b' })],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      const { user } = render(
        '/python/repositories/simple/content?sort=filename',
      );

      const grid = await table();
      await within(grid).findByText('a');
      expect(lab.queries.at(-1)?.get('ordering')).toBe('name');

      await user.click(
        grid.querySelector('[data-cy="sort_name"]') as HTMLElement,
      );

      await waitFor(() =>
        expect(lab.queries.at(-1)?.get('ordering')).toBe('-name'),
      );
    });

    it('says there are no packages in the latest version when the list is empty', async () => {
      const repository = serveRepository();
      server.use(
        servePackages([], repository.latest_version_href as string).handler,
      );
      render('/python/repositories/simple/content');

      expect(
        await screen.findByText('No packages in the latest version'),
      ).toBeVisible();
      expect(
        screen.getByText('Sync this repository or upload packages to it.'),
      ).toBeVisible();
    });

    it('sends no package request for a repository without a latest version and says it holds none', async () => {
      serveRepository({ latest_version_href: null });
      const seen: string[] = [];
      server.events.on('request:start', ({ request }) => {
        seen.push(new URL(request.url).pathname);
      });
      server.use(
        http.get(`*${PACKAGES}`, () =>
          HttpResponse.json({ count: 9, results: [] }),
        ),
      );
      render('/python/repositories/simple/content');

      expect(
        await screen.findByText('No packages in the latest version'),
      ).toBeVisible();
      expect(seen.filter((path) => path.includes('/content/'))).toEqual([]);
      server.events.removeAllListeners();
    });

    it('shows the error state with Retry when the read failed and reads again on Retry', async () => {
      const repository = serveRepository();
      let failing = true;
      const lab = servePackages(
        [row(1)],
        repository.latest_version_href as string,
      );
      server.use(
        http.get(`*${PACKAGES}`, () =>
          failing
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : undefined,
        ),
        lab.handler,
      );
      const { user } = render('/python/repositories/simple/content');

      expect(
        await screen.findByText('Packages could not be displayed.'),
      ).toBeVisible();
      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await within(await table()).findByText('pkg-001');
    });

    it('is a tab of the repository beside Versions and Distributions, at its own address', async () => {
      const repository = serveRepository();
      server.use(
        servePackages([row(1)], repository.latest_version_href as string)
          .handler,
      );
      render('/python/repositories/simple/content');

      await within(await table()).findByText('pkg-001');
      const tabs = screen
        .getAllByRole('link')
        .filter((link) =>
          /\/python\/repositories\/simple\//.test(
            link.getAttribute('href') ?? '',
          ),
        )
        .map((link) => link.textContent);
      expect(tabs).toEqual(
        expect.arrayContaining([
          'Details',
          'Versions',
          'Distributions',
          'Content',
        ]),
      );
    });
  },
);
