import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type TestDistributionPlugin,
  artifactDistribution,
  coreDistributionListHandler,
  coreDistributionRow,
  distributionListHandler,
  listOf,
  pluginDistribution,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { frameworkCoreRoutes } from '../routes';

const API = '/pulp/api/v3';

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkCoreRoutes()))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
  resetSessionEvents();
});

function renderList(route = '/distributions') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const reportPlugins = (components: string[]) =>
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: components.map((component) => ({
          component,
          version: '3.0.0',
        })),
      }),
    ),
  );

// A lab: the rows of every plugin, answered by the cross-plugin list and by
// each plugin's own list, the way the server answers them.
function serveLab(
  rows: Partial<Record<TestDistributionPlugin, IDistribution[]>>,
) {
  const own = Object.entries(rows).map(([plugin, list]) =>
    distributionListHandler(plugin as TestDistributionPlugin, list ?? []),
  );
  const core = coreDistributionListHandler([
    ...Object.values(rows)
      .flatMap((list) => list ?? [])
      .map(coreDistributionRow),
    artifactDistribution(),
  ]);
  server.use(core.handler, ...own.map(({ handler }) => handler));

  return { core, own };
}

const named = (plugin: TestDistributionPlugin, count: number, from = 1) =>
  Array.from({ length: count }, (_, n) => {
    const name = `${plugin}-${String(from + n).padStart(4, '0')}`;
    return pluginDistribution(plugin, { name, base_path: name });
  });

const tableOf = () => screen.findByRole('grid', { name: 'Distributions' });

const bodyRows = (table: HTMLElement) =>
  Array.from(table.querySelectorAll('tbody tr')) as HTMLElement[];

// Every request the page sends to the API, apart from the session's own.
function recordRequests() {
  const all: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    if (
      url.pathname.startsWith(API) &&
      !/^\/pulp\/api\/v3\/(login|status|users|groups|roles)\//.test(
        url.pathname,
      )
    ) {
      all.push(`${url.pathname}${url.search}`);
    }
  };
  server.events.on('request:start', onStart);

  return {
    all,
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

// The address of one object of any plugin, or the permission read of a user.
const SINGLE_OBJECT =
  /\/distributions\/[a-z]+\/[a-z]+\/[0-9a-f-]{36}\/|my_permissions/;

describe(
  'Integration: the list of every distribution',
  { tags: ['integration'] },
  () => {
    it('shows each row with its name, plugin, base path and the client URL of its plugin', async () => {
      serveLab({
        file: [
          pluginDistribution('file', {
            name: 'manuals',
            base_path: 'docs/manuals',
          }),
        ],
        python: [
          pluginDistribution('python', {
            name: 'wheels',
            base_path: 'index/wheels',
            base_url: 'https://pulp.example/pypi/index/wheels/',
          }),
        ],
        ansible: [
          pluginDistribution('ansible', {
            name: 'galaxy',
            base_path: 'collections/galaxy',
          }),
        ],
      });

      renderList();
      const table = await tableOf();
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );

      expect(bodyRows(table)).toHaveLength(3);
      const row = (name: string) =>
        screen.getByText(name).closest('tr') as HTMLElement;

      const manuals = row('manuals');
      expect(within(manuals).getByText('File')).toBeVisible();
      expect(within(manuals).getByText('docs/manuals')).toBeVisible();
      expect(
        within(manuals).getByText(
          'https://pulp.example/pulp/content/docs/manuals/',
        ),
      ).toBeVisible();

      // python is reached through its own index and ansible through its
      // collection source, never through the content path
      expect(
        within(row('wheels')).getByText(
          'https://pulp.example/pypi/index/wheels/',
        ),
      ).toBeVisible();
      expect(
        within(row('wheels')).queryByText(/pulp\/content/),
      ).not.toBeInTheDocument();
      expect(
        within(row('galaxy')).getByText(
          'https://pulp.example/pulp_ansible/galaxy/collections/galaxy/',
        ),
      ).toBeVisible();
      expect(
        within(row('galaxy')).queryByText(/pulp\/content/),
      ).not.toBeInTheDocument();
    });

    it('reads one page of fifty by name, limited to the types of the installed plugins', async () => {
      reportPlugins(['core', 'file', 'deb', 'python', 'maven']);
      const lab = serveLab({
        file: named('file', 60),
        maven: named('maven', 2),
      });

      renderList();
      const table = await tableOf();

      expect(lab.core.queries).toHaveLength(1);
      const query = lab.core.queries[0] as URLSearchParams;
      expect(query.get('limit')).toBe('50');
      expect(query.get('offset')).toBe('0');
      expect(query.get('ordering')).toBe('name');
      expect(query.get('pulp_type__in')).toBe(
        'file.file,deb.apt-distribution,python.python,maven.maven',
      );
      expect(bodyRows(table)).toHaveLength(50);
    });

    it('never shows an artifact distribution, whatever the plugins are', async () => {
      serveLab({ file: named('file', 3) });

      renderList();
      const table = await tableOf();

      expect(bodyRows(table)).toHaveLength(3);
      expect(
        screen.queryByText(artifactDistribution().name),
      ).not.toBeInTheDocument();
    });

    it('says that no plugin is installed that has distributions, and reads nothing', async () => {
      reportPlugins(['core', 'certguard']);
      const lab = serveLab({});

      renderList();

      await screen.findByText('No distributions yet');
      expect(lab.core.queries).toHaveLength(0);
    });

    it('asks for a plugin list once the server has answered, and not before', async () => {
      reportPlugins(['core', 'file']);
      const lab = serveLab({ file: named('file', 2) });

      renderList();
      await tableOf();

      expect(
        (lab.core.queries[0] as URLSearchParams).get('pulp_type__in'),
      ).toBe('file.file');
    });

    it('shows a row the plugin screens do not know read-only under its type name', async () => {
      const strange = coreDistributionRow({
        ...pluginDistribution('file', {
          name: 'strange',
          base_path: 'odd/path',
        }),
        prn: 'prn:zzz.zzzdistribution:1',
      });
      // a server that ignores the type filter answers the row all the same
      server.use(listOf(`${API}/distributions/`, [strange]).handler);

      renderList();
      const table = await tableOf();

      const row = screen.getByText('strange').closest('tr') as HTMLElement;
      expect(within(row).getByText('zzz.zzzdistribution')).toBeVisible();
      expect(within(row).queryByRole('link')).not.toBeInTheDocument();
      expect(bodyRows(table)).toHaveLength(1);
    });

    it('costs one list request and one read per plugin for a page of fifty rows of three plugins', async () => {
      const lab = serveLab({
        file: named('file', 17),
        deb: named('deb', 17),
        python: named('python', 16),
      });
      const requests = recordRequests();

      renderList();
      const table = await tableOf();
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );
      requests.stop();

      expect(bodyRows(table)).toHaveLength(50);
      expect(lab.core.queries).toHaveLength(1);
      // the page, then one chunked read for each plugin
      expect(requests.all).toHaveLength(4);
      expect(requests.all.filter((path) => SINGLE_OBJECT.test(path))).toEqual(
        [],
      );
      for (const own of lab.own) {
        expect(own.queries).toHaveLength(1);
      }
    });

    it('keeps the number of requests of a page of five hundred bounded by the budget of the screen', async () => {
      serveLab({
        file: named('file', 170),
        deb: named('deb', 170),
        python: named('python', 170),
      });
      const requests = recordRequests();

      renderList('/distributions?page_size=500');
      const table = await tableOf();
      await waitFor(
        () => expect(table).toHaveAttribute('data-columns-loaded', 'true'),
        { timeout: 20_000 },
      );
      requests.stop();

      expect(bodyRows(table)).toHaveLength(500);
      expect(requests.all.length).toBeLessThanOrEqual(48);
      expect(requests.all.filter((path) => SINGLE_OBJECT.test(path))).toEqual(
        [],
      );
    }, 60_000);

    it('keeps the rows and says which column failed when the client URLs cannot be read, and reads them again on request', async () => {
      serveLab({ file: named('file', 2) });
      // the plugin's own read fails until the test says otherwise; a handler that
      // answers nothing leaves the request to the lab
      let failing = true;
      server.use(
        http.get(`*${API}/distributions/file/file/`, () =>
          failing
            ? HttpResponse.json({ detail: 'Broken.' }, { status: 500 })
            : undefined,
        ),
      );

      const { user } = renderList();
      const table = await tableOf();

      await screen.findByText('Client URLs could not be read.');
      expect(bodyRows(table)).toHaveLength(2);

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(
          screen.queryByText('Client URLs could not be read.'),
        ).not.toBeInTheDocument(),
      );
      expect(
        within(bodyRows(table)[0] as HTMLElement).getByText(/pulp\/content/),
      ).toBeVisible();
    });

    it('reads the page, size and order of the address and keeps them there when the page is changed', async () => {
      const lab = serveLab({ file: named('file', 30) });

      const { user } = renderList(
        '/distributions?page=2&page_size=10&sort=-base_path',
      );
      const table = await tableOf();

      const query = lab.core.queries[0] as URLSearchParams;
      expect(query.get('offset')).toBe('10');
      expect(query.get('limit')).toBe('10');
      expect(query.get('ordering')).toBe('-base_path');
      expect(bodyRows(table)).toHaveLength(10);

      await user.click(
        screen.getAllByRole('button', { name: /next page/i })[0],
      );

      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          '/distributions?page=3&page_size=10&sort=-base_path',
        ),
      );
    });

    it('offers a sort control on the name, plugin and base path only, and sends only those orders', async () => {
      const lab = serveLab({ file: named('file', 3) });

      const { user } = renderList('/distributions?sort=-pulp_labels');
      const table = await tableOf();

      expect((lab.core.queries[0] as URLSearchParams).get('ordering')).toBe(
        'name',
      );
      expect(
        Array.from(table.querySelectorAll('[data-cy^="sort_"]')).map((icon) =>
          icon.getAttribute('data-cy'),
        ),
      ).toEqual(['sort_name', 'sort_pulp_type', 'sort_base_path']);

      await user.click(
        document.querySelector('[data-cy="sort_pulp_type"]') as HTMLElement,
      );
      await waitFor(() =>
        expect(lab.core.queries.at(-1)?.get('ordering')).toMatch(/pulp_type/),
      );
    });

    it('goes to the last page that has rows when the address names a page past the end', async () => {
      serveLab({ file: named('file', 12) });

      renderList('/distributions?page=9&page_size=10');
      await tableOf();

      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          '/distributions?page=2&page_size=10',
        ),
      );
    });

    it('shows the refusal of a user who may not read distributions with the reason of the server', async () => {
      server.use(
        http.get(`*${API}/distributions/`, () =>
          HttpResponse.json(
            { detail: 'You do not have permission to perform this action.' },
            { status: 403 },
          ),
        ),
      );

      renderList();

      await screen.findByText(/insufficient permissions/i);
    });

    it('offers a retry when the page cannot be read', async () => {
      server.use(
        http.get(`*${API}/distributions/`, () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );

      renderList();

      await screen.findByText('Distributions could not be displayed.');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    });

    it('names the plugin list that could not be read instead of guessing which plugins are installed', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );
      const lab = serveLab({ file: named('file', 1) });

      renderList();

      await screen.findByText(
        'The plugin list could not be loaded',
        undefined,
        {
          timeout: 10_000,
        },
      );
      expect(lab.core.queries).toHaveLength(0);
    }, 20_000);
  },
);
