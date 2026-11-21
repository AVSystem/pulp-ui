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
  publicationListHandler,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';

// The Packages tab of an rpm repository as a user meets it: routed from the
// manifest, drawn from the rpm descriptor, and answered by a server that cuts
// every row to the fields a request asks for.

const API = '/pulp/api/v3';
const PACKAGES = `${API}/content/rpm/packages/`;

const RPM: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'rpm',
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
      {useRoutes(guardRoutes(frameworkRoutes([RPM])))}
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
  epoch: string | number;
  version: string;
  release: string;
  arch: string;
  summary: string;
  // a field the tab never asks for
  description: string;
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  pulp_href: `${PACKAGES}00000000-0000-4000-8000-${String(n).padStart(12, '0')}/`,
  name: `pkg-${String(n).padStart(3, '0')}`,
  epoch: '0',
  version: '1.0',
  release: `${n}.el9`,
  arch: 'x86_64',
  summary: `Summary of package ${n}`,
  description: 'a long description the tab does not read',
  ...overrides,
});

// The package list of a server: only the rows of the version asked for, the
// `name__contains` and `arch` filters, the ordering and the fields cut.
function servePackages(rows: Row[], version: string) {
  return listOf(PACKAGES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      query.get('repository_version') === version &&
      (query.get('name__contains') === null ||
        each.name.includes(query.get('name__contains') as string)) &&
      (query.get('arch') === null || each.arch === query.get('arch')),
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
  const repository = pluginRepository('rpm', {
    name: 'baseos',
    ...overrides,
  });
  server.use(
    pluginListHandler('rpm', 'repository', [repository], { pageSize: 1000 })
      .handler,
    pluginListHandler('rpm', 'remote', [], { pageSize: 1000 }).handler,
    distributionListHandler('rpm', []).handler,
    publicationListHandler('rpm', []).handler,
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
  'Integration: the Packages tab of an rpm repository',
  { tags: ['integration'] },
  () => {
    it('lists the packages of the latest version with the name, the version, the architecture and the summary, and asks for nothing else', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [
          row(1, { epoch: '0', version: '5.2', release: '3.el9' }),
          row(2, {
            epoch: '2',
            version: '1.1',
            release: '4.el9',
            arch: 'noarch',
          }),
          row(3, { epoch: 1 }),
        ],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render('/rpm/repositories/baseos/packages');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim());
      expect(headers).toEqual(['Name', 'Version', 'Arch', 'Summary']);
      const cells = (index: number) =>
        within(bodyRows(grid)[index] as HTMLElement)
          .getAllByRole('cell')
          .map((cell) => cell.textContent);
      expect(cells(0)).toEqual([
        'pkg-001',
        '5.2-3.el9',
        'x86_64',
        'Summary of package 1',
      ]);
      // the epoch is shown only when it is not 0, as a number or as text
      expect(cells(1)[1]).toBe('2:1.1-4.el9');
      expect(cells(2)[1]).toBe('1:1.0-3.el9');

      expect(lab.queries).toHaveLength(1);
      const query = lab.queries[0] as URLSearchParams;
      expect(query.get('repository_version')).toBe(
        repository.latest_version_href,
      );
      expect(query.get('limit')).toBe('20');
      expect(query.get('offset')).toBe('0');
      expect(query.get('ordering')).toBe('name');
      expect(query.getAll('fields').sort()).toEqual([
        'arch',
        'epoch',
        'name',
        'pulp_href',
        'release',
        'summary',
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
      render('/rpm/repositories/baseos/packages');

      const grid = await table();
      await within(grid).findByText('pkg-020');

      expect(bodyRows(grid)).toHaveLength(20);
      expect(seen.filter((path) => path.includes('/content/'))).toEqual([
        '/pulp/api/v3/content/rpm/packages/',
      ]);
      server.events.removeAllListeners();
    });

    it('pages by 20 and shows the next page from the address', async () => {
      const repository = serveRepository();
      const rows = Array.from({ length: 45 }, (_, index) => row(index + 1));
      const lab = servePackages(rows, repository.latest_version_href as string);
      server.use(lab.handler);
      const { user } = render('/rpm/repositories/baseos/packages');

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

    it('filters by name and by architecture, each by the parameter the server takes, and shows what is applied', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [
          row(1, { name: 'bash' }),
          row(2, { name: 'bash-completion', arch: 'noarch' }),
          row(3, { name: 'zsh' }),
        ],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render(
        '/rpm/repositories/baseos/packages?name__contains=bash&arch=noarch',
      );

      const grid = await table();
      await within(grid).findByText('bash-completion');

      expect(bodyRows(grid)).toHaveLength(1);
      const query = lab.queries.at(-1) as URLSearchParams;
      expect(query.get('name__contains')).toBe('bash');
      expect(query.get('arch')).toBe('noarch');
      const applied = (name: string) =>
        within(screen.getByRole('list', { name })).getAllByRole('listitem');
      expect(applied('Package name').map((item) => item.textContent)).toEqual([
        'bash',
      ]);
      expect(applied('Arch').map((item) => item.textContent)).toEqual([
        'noarch',
      ]);
    });

    it('applies a name typed into the filter and goes back to the first page', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [row(1, { name: 'bash' }), row(2, { name: 'zsh' })],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      const { user } = render('/rpm/repositories/baseos/packages?page=1');

      await within(await table()).findByText('zsh');
      await user.type(
        screen.getByRole('textbox', { name: 'name__contains' }),
        'zs',
      );
      await user.click(screen.getByRole('button', { name: 'Search' }));

      await waitFor(() => expect(location()).toMatch(/name__contains=zs/));
      await waitFor(() =>
        expect(lab.queries.at(-1)?.get('name__contains')).toBe('zs'),
      );
      const grid = await table();
      await waitFor(() => expect(bodyRows(grid)).toHaveLength(1));
      expect(within(grid).queryByText('bash')).toBeNull();
    });

    it('sorts by name from the header and ignores a sort the server is not asked for', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [row(1, { name: 'a' }), row(2, { name: 'b' })],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      const { user } = render('/rpm/repositories/baseos/packages?sort=summary');

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
      render('/rpm/repositories/baseos/packages');

      expect(
        await screen.findByText('No packages in the latest version'),
      ).toBeVisible();
      expect(
        screen.getByText('Sync this repository or add packages to it.'),
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
      render('/rpm/repositories/baseos/packages');

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
      const { user } = render('/rpm/repositories/baseos/packages');

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
      render('/rpm/repositories/baseos/packages');

      await within(await table()).findByText('pkg-001');
      const tabs = screen
        .getAllByRole('link')
        .filter((link) =>
          /\/rpm\/repositories\/baseos\//.test(link.getAttribute('href') ?? ''),
        )
        .map((link) => link.textContent);
      expect(tabs).toEqual(
        expect.arrayContaining([
          'Details',
          'Versions',
          'Distributions',
          'Packages',
        ]),
      );
    });
  },
);
