import { screen, within } from '@testing-library/react';
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

// The Content tab of a deb repository as a user meets it: routed from the
// manifest, drawn from the deb descriptor, and answered by a server that cuts
// every row to the fields a request asks for.

const API = '/pulp/api/v3';
const PACKAGES = `${API}/content/deb/packages/`;

const DEB: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'deb',
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
      {useRoutes(guardRoutes(frameworkRoutes([DEB])))}
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
  package: string;
  version: string;
  architecture: string;
  // a field the tab never asks for
  description: string;
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  pulp_href: `${PACKAGES}00000000-0000-4000-8000-${String(n).padStart(12, '0')}/`,
  package: `pkg-${String(n).padStart(3, '0')}`,
  version: `1.0-${n}`,
  architecture: 'amd64',
  description: 'a long description the tab does not read',
  ...overrides,
});

// The package list of a server: only the rows of the version asked for, the
// `package__contains` and `architecture` filters and the fields cut.
function servePackages(rows: Row[], version: string) {
  return listOf(PACKAGES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      query.get('repository_version') === version &&
      (query.get('package__contains') === null ||
        each.package.includes(query.get('package__contains') as string)) &&
      (query.get('architecture') === null ||
        each.architecture === query.get('architecture')),
    projected: projectedBy,
  });
}

function serveRepository(
  overrides: Partial<ReturnType<typeof pluginRepository>> = {},
) {
  const repository = pluginRepository('deb', {
    name: 'baseos',
    ...overrides,
  });
  server.use(
    pluginListHandler('deb', 'repository', [repository], { pageSize: 1000 })
      .handler,
    pluginListHandler('deb', 'remote', [], { pageSize: 1000 }).handler,
    distributionListHandler('deb', []).handler,
    publicationListHandler('deb', []).handler,
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

describe(
  'Integration: the Content tab of a deb repository',
  { tags: ['integration'] },
  () => {
    it('lists the packages of the latest version with the package, the version and the architecture, and asks for nothing else', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [row(1), row(2, { architecture: 'all' })],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render('/deb/repositories/baseos/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim())
        // the first column holds the check boxes
        .slice(1);
      expect(headers).toEqual(['Package', 'Version', 'Architecture', 'Labels']);
      const cells = (index: number) =>
        within(bodyRows(grid)[index] as HTMLElement)
          .getAllByRole('cell')
          .map((cell) => cell.textContent)
          // the first cell holds the check box
          .slice(1);
      expect(cells(0)).toEqual(['pkg-001', '1.0-1', 'amd64', 'None']);
      expect(cells(1)).toEqual(['pkg-002', '1.0-2', 'all', 'None']);

      expect(lab.queries).toHaveLength(1);
      const query = lab.queries[0] as URLSearchParams;
      expect(query.get('repository_version')).toBe(
        repository.latest_version_href,
      );
      expect(query.get('ordering')).toBe('package');
      expect(query.getAll('fields').sort()).toEqual([
        'architecture',
        'package',
        'pulp_href',
        'pulp_labels',
        'version',
      ]);
    });

    it('filters by package name and architecture, each by the parameter the server takes', async () => {
      const repository = serveRepository();
      const lab = servePackages(
        [
          row(1, { package: 'bash' }),
          row(2, { package: 'bash-completion', architecture: 'all' }),
          row(3, { package: 'zsh' }),
        ],
        repository.latest_version_href as string,
      );
      server.use(lab.handler);
      render(
        '/deb/repositories/baseos/content?package__contains=bash&architecture=all',
      );

      const grid = await table();
      await within(grid).findByText('bash-completion');

      expect(bodyRows(grid)).toHaveLength(1);
      const query = lab.queries.at(-1) as URLSearchParams;
      expect(query.get('package__contains')).toBe('bash');
      expect(query.get('architecture')).toBe('all');
    });

    it('says there are no packages in the latest version when the list is empty', async () => {
      const repository = serveRepository();
      server.use(
        servePackages([], repository.latest_version_href as string).handler,
      );
      render('/deb/repositories/baseos/content');

      expect(
        await screen.findByText('No packages in the latest version'),
      ).toBeVisible();
    });

    it('is a tab of the repository, at its own address', async () => {
      const repository = serveRepository();
      server.use(
        servePackages([row(1)], repository.latest_version_href as string)
          .handler,
      );
      render('/deb/repositories/baseos/content');

      await within(await table()).findByText('pkg-001');
      const tabs = screen
        .getAllByRole('link')
        .filter((link) =>
          /\/deb\/repositories\/baseos\//.test(link.getAttribute('href') ?? ''),
        )
        .map((link) => link.textContent);
      expect(tabs).toEqual(
        expect.arrayContaining([
          'Details',
          'Versions',
          'Content',
          'Distributions',
        ]),
      );
    });
  },
);
