import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import fileDescriptor from 'src/descriptors/file/descriptor';
import rpmDescriptor from 'src/descriptors/rpm/descriptor';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, projectedBy } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import type { PluginDescriptor } from '../descriptor';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { GlobalContentList } from './global-content-list';

// The list of all rpm packages a user may see, as the user meets it: routed from
// the manifest, drawn from the rpm descriptor and answered by a server that cuts
// every row to the fields a request asks for. The several-types case draws the
// screen from a descriptor that declares two types.

const API = '/pulp/api/v3';
const PACKAGES = `${API}/content/rpm/packages/`;
const FILES = `${API}/content/file/files/`;

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

function Where() {
  const { pathname, search } = useLocation();

  return <p data-testid='location'>{`${pathname}${search}`}</p>;
}

function Routed() {
  return (
    <>
      <Where />
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
  epoch: string;
  version: string;
  release: string;
  arch: string;
  summary: string;
  pulp_labels: Record<string, string | null>;
  // a field the list never asks for
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
  pulp_labels: {},
  description: 'a long description the list does not read',
  ...overrides,
});

// The package list of a server: every row the user may see, the `name__contains`
// filter, the label selector, the ordering and the fields cut.
function servePackages(rows: Row[]) {
  const lab = listOf(PACKAGES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      (query.get('name__contains') === null ||
        each.name.includes(query.get('name__contains') as string)) &&
      (query.get('pulp_label_select') === null ||
        Object.entries(each.pulp_labels).some(
          ([key, value]) =>
            `${key}=${value}` === query.get('pulp_label_select'),
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
  const labelWrites: { href: string; action: string; body: unknown }[] = [];
  server.use(
    lab.handler,
    http.post(`*${PACKAGES}:id/:action/`, async ({ params, request }) => {
      labelWrites.push({
        href: `${PACKAGES}${params.id}/`,
        action: String(params.action),
        body: await request.json(),
      });
      return HttpResponse.json({});
    }),
  );

  return { ...lab, labelWrites };
}

// Every request of the page the list itself sends: not the sign-in or the reads
// of the user's own roles, which belong to the session.
function recordRequests() {
  const all: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (url.pathname.startsWith(API)) {
      all.push(`${url.pathname}${url.search}`);
    }
  };
  server.events.on('request:start', onStart);

  return {
    own: () =>
      all.filter(
        (path) =>
          !/^\/pulp\/api\/v3\/(login|status|users|groups|roles)\//.test(path),
      ),
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

const table = () => screen.findByRole('grid', { name: 'Packages' });
const bodyRows = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('row')
    .filter((each) => within(each).queryAllByRole('columnheader').length === 0);
const location = () => screen.getByTestId('location').textContent;

describe(
  'Integration: the global content list of rpm',
  { tags: ['integration'] },
  () => {
    it('lists the packages of every repository the user may see with the columns of the type, and asks for the fields it shows and no version', async () => {
      const lab = servePackages([
        row(1, { epoch: '2', version: '5.2', release: '3.el9' }),
        row(2, { pulp_labels: { team: 'ops' } }),
      ]);
      render('/rpm/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim());
      expect(headers).toEqual(['Name', 'Version', 'Arch', 'Summary', 'Labels']);
      const cells = (index: number) =>
        within(bodyRows(grid)[index] as HTMLElement)
          .getAllByRole('cell')
          .map((cell) => cell.textContent);
      expect(cells(0)).toEqual([
        'pkg-001',
        '2:5.2-3.el9',
        'x86_64',
        'Summary of package 1',
        'None',
      ]);
      expect(
        within(bodyRows(grid)[1] as HTMLElement).getByText('team: ops'),
      ).toBeVisible();

      expect(lab.queries).toHaveLength(1);
      const query = lab.queries[0] as URLSearchParams;
      expect(query.get('repository_version')).toBeNull();
      expect(query.get('repository_version_added')).toBeNull();
      expect(query.get('repository_version_removed')).toBeNull();
      expect(query.get('ordering')).toBe('name');
      expect(query.getAll('fields').sort()).toEqual([
        'arch',
        'epoch',
        'name',
        'pulp_href',
        'pulp_labels',
        'release',
        'summary',
        'version',
      ]);
      expect(
        screen.getByRole('heading', { name: 'RPM content' }),
      ).toBeVisible();
    });

    it('sends one list request for a page of 50 rows, with no version filter and no request per row', async () => {
      const rows = Array.from({ length: 120 }, (_, index) => row(index + 1));
      const lab = servePackages(rows);
      const requests = recordRequests();
      render('/rpm/content');

      const grid = await table();
      await within(grid).findByText('pkg-050');
      // nothing else is sent after the rows are shown
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(bodyRows(grid)).toHaveLength(50);
      expect(requests.own()).toHaveLength(1);
      expect(requests.own()[0]).toMatch(
        /^\/pulp\/api\/v3\/content\/rpm\/packages\/\?/,
      );
      expect(requests.own()[0]).not.toContain('repository_version');
      expect(lab.queries).toHaveLength(1);
      expect(lab.queries[0]?.get('limit')).toBe('50');
      expect(lab.queries[0]?.get('offset')).toBe('0');
      requests.stop();
    });

    it('pages from the address, one request for each page', async () => {
      const rows = Array.from({ length: 120 }, (_, index) => row(index + 1));
      const lab = servePackages(rows);
      const { user } = render('/rpm/content');

      await within(await table()).findByText('pkg-001');
      await user.click(
        screen.getAllByRole('button', {
          name: 'Go to next page',
        })[0] as HTMLElement,
      );

      await waitFor(() => expect(location()).toMatch(/[?&]page=2/));
      await within(await table()).findByText('pkg-051');
      expect(lab.queries.at(-1)?.get('offset')).toBe('50');
      expect(lab.queries.at(-1)?.get('limit')).toBe('50');
      expect(lab.queries).toHaveLength(2);
    });

    it('filters by the label selector and by name and says which filters are applied', async () => {
      const lab = servePackages([
        row(1, { pulp_labels: { team: 'ops' } }),
        row(2),
      ]);
      render('/rpm/content?pulp_label_select=team%3Dops&name__contains=pkg');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      const query = lab.queries.at(-1) as URLSearchParams;
      expect(query.get('pulp_label_select')).toBe('team=ops');
      expect(query.get('name__contains')).toBe('pkg');
      expect(bodyRows(grid)).toHaveLength(1);
      expect(
        within(screen.getByRole('list', { name: 'Labels' })).getByText(
          'team=ops',
        ),
      ).toBeVisible();
    });

    it('sorts by a column the server orders by, from the address', async () => {
      const lab = servePackages([row(1), row(2)]);
      const { user } = render('/rpm/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');
      await user.click(within(grid).getByRole('button', { name: 'Name' }));

      await waitFor(() => expect(location()).toMatch(/sort=-name/));
      await waitFor(() =>
        expect(lab.queries.at(-1)?.get('ordering')).toBe('-name'),
      );
    });

    it('offers the label editor to a holder of core.manage_content_labels and sends set_label to the unit', async () => {
      const lab = servePackages([row(1)]);
      const { user } = render('/rpm/content');

      await within(await table()).findByText('pkg-001');
      await user.click(
        await screen.findByRole('button', {
          name: 'Edit labels of pkg-001-1.0-1.el9.x86_64',
        }),
      );
      const dialog = await screen.findByRole('dialog');
      await user.type(within(dialog).getByLabelText('Label key'), 'team');
      await user.type(within(dialog).getByLabelText('Label value'), 'ops');
      await user.click(
        within(dialog).getByRole('button', { name: 'Add label' }),
      );

      await waitFor(() => expect(lab.labelWrites).toHaveLength(1));
      expect(lab.labelWrites[0]).toEqual({
        href: row(1).pulp_href,
        action: 'set_label',
        body: { key: 'team', value: 'ops' },
      });
    });

    it('shows labels but no editor to a user without core.manage_content_labels', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['rpm.view_rpmrepository']],
      });
      servePackages([row(1, { pulp_labels: { team: 'ops' } })]);
      render('/rpm/content');

      const grid = await table();
      await within(grid).findByText('pkg-001');

      expect(within(grid).getByText('team: ops')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: /Edit labels of/ }),
      ).toBeNull();
    });

    it('offers no selection and no action on the rows: the list only shows', async () => {
      servePackages([row(1), row(2)]);
      render('/rpm/content');

      await within(await table()).findByText('pkg-002');

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(
        screen.queryByRole('button', { name: 'Remove from repository' }),
      ).toBeNull();
    });

    it('says there is no content when the server lists none, and no filter is set', async () => {
      servePackages([]);
      render('/rpm/content');

      expect(await screen.findByText('No content to show')).toBeVisible();
    });

    it('says so, with a way to clear the filter, when a filter matches nothing', async () => {
      servePackages([row(1)]);
      render('/rpm/content?name__contains=zzz');

      expect(await screen.findByText(/No results found/)).toBeVisible();
    });

    it('shows the server failure with a Retry, never a spinner that does not end', async () => {
      let fail = true;
      server.use(
        http.get(`*${PACKAGES}`, () =>
          fail
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json({
                count: 1,
                next: null,
                previous: null,
                results: [row(1)],
              }),
        ),
      );
      const { user } = render('/rpm/content');

      expect(
        await screen.findByText('Packages could not be displayed.'),
      ).toBeVisible();
      fail = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await within(await table()).findByText('pkg-001');
    });
  },
);

describe(
  'Integration: the global content list of a plugin with several content types',
  { tags: ['integration'] },
  () => {
    // A descriptor that declares the file type first and the rpm type second.
    const several: PluginDescriptor = {
      ...rpmDescriptor,
      contentTypes: [
        ...(fileDescriptor.contentTypes ?? []),
        ...(rpmDescriptor.contentTypes ?? []),
      ],
    };

    function renderSeveral(route: string) {
      return renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <Where />
            <GlobalContentList plugin='rpm' descriptor={several} />
          </PermissionsKnown>
        </AppContextProvider>,
        { route },
      );
    }

    it('shows a choice of type, starts on the first and keeps the choice in the address as ?type=', async () => {
      const files = listOf(
        FILES,
        [
          {
            pulp_href: `${FILES}00000000-0000-4000-8000-000000000001/`,
            relative_path: 'docs/a.txt',
            pulp_created: '2024-03-04T10:00:00.000000Z',
            pulp_labels: {},
          },
        ],
        { pageSize: 1000, projected: projectedBy },
      );
      const packages = servePackages([row(1)]);
      server.use(files.handler);
      const { user } = renderSeveral('/rpm/content');

      expect(await screen.findByRole('grid', { name: 'Files' })).toBeVisible();
      expect(packages.queries).toHaveLength(0);

      await user.click(screen.getByRole('button', { name: 'Packages' }));

      await waitFor(() =>
        expect(location()).toBe('/rpm/content?type=rpm.package'),
      );
      await within(await table()).findByText('pkg-001');
      expect(packages.queries).toHaveLength(1);
    });

    it('opens the type the address names', async () => {
      servePackages([row(1)]);
      renderSeveral('/rpm/content?type=rpm.package');

      await within(await table()).findByText('pkg-001');
      expect(
        screen.getByRole('button', { name: 'Packages', pressed: true }),
      ).toBeVisible();
    });
  },
);
