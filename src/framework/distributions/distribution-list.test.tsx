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
  type IRepository,
  type TestDistributionPlugin,
  type TestPlugin,
  artifactDistribution,
  contentGuard,
  contentGuardListHandler,
  coreDistributionListHandler,
  coreDistributionRow,
  corePublicationListHandler,
  coreRepositoryListHandler,
  distributionListHandler,
  listOf,
  page,
  pluginDistribution,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
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

    it('links the name of each row of a plugin to its distribution page, and the guarded-URL note too', async () => {
      const guard = contentGuard({ name: 'customers-only' });
      serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'guarded one/1',
              content_guard: guard.pulp_href,
            }),
          ],
          python: [pluginDistribution('python', { name: 'wheels' })],
        },
        guards: [guard],
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      const guarded = rowOf('guarded one/1');
      expect(
        within(guarded).getByRole('link', { name: 'guarded one/1' }),
      ).toHaveAttribute('href', '/file/distributions/guarded%20one%2F1/');
      expect(
        within(guarded).getByRole('link', {
          name: 'The client snippet shows how.',
        }),
      ).toHaveAttribute('href', '/file/distributions/guarded%20one%2F1/');
      expect(
        within(rowOf('wheels')).getByRole('link', { name: 'wheels' }),
      ).toHaveAttribute('href', '/python/distributions/wheels/');
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

      await screen.findByText('Distribution details could not be read.');
      expect(bodyRows(table)).toHaveLength(2);

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(
          screen.queryByText('Distribution details could not be read.'),
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

    it('offers a sort control on the name, plugin, base path and created date only, and sends only those orders', async () => {
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
      ).toEqual([
        'sort_name',
        'sort_pulp_type',
        'sort_base_path',
        'sort_pulp_created',
      ]);

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

// The lab of the derived columns: the distributions of the plugins and what
// they point at, answered by the lists that name repositories, publications
// and guards by address and by each publication plugin's own list.
function serveBound({
  rows,
  repositories = [],
  publications = {},
  guards = [],
  publicationPageSize,
}: {
  rows: Partial<Record<TestDistributionPlugin, IDistribution[]>>;
  repositories?: IRepository[];
  publications?: Partial<
    Record<'file' | 'deb' | 'rpm', ReturnType<typeof pluginPublication>[]>
  >;
  guards?: ReturnType<typeof contentGuard>[];
  publicationPageSize?: number;
}) {
  const lab = serveLab(rows);
  const everyPublication = Object.values(publications).flat();
  const repositoryList = coreRepositoryListHandler(repositories);
  const publicationList = corePublicationListHandler(everyPublication);
  const guardList = contentGuardListHandler(guards);
  const index = Object.entries(publications).map(([plugin, list]) => ({
    plugin,
    ...publicationListHandler(plugin as TestPlugin, list ?? [], {
      ...(publicationPageSize ? { pageSize: publicationPageSize } : {}),
    }),
  }));
  server.use(
    repositoryList.handler,
    publicationList.handler,
    guardList.handler,
    ...index.map(({ handler }) => handler),
  );

  return { ...lab, repositoryList, publicationList, guardList, index };
}

const rowOf = (name: string) =>
  screen.getByText(name).closest('tr') as HTMLElement;

const settled = async (table: HTMLElement) =>
  waitFor(() => expect(table).toHaveAttribute('data-columns-loaded', 'true'), {
    timeout: 20_000,
  });

describe(
  'Integration: what each distribution serves, how it is protected and whether it works',
  { tags: ['integration'] },
  () => {
    it('says what each row serves: a repository with a link, a publication with its version, a pinned version or nothing', async () => {
      const repository = pluginRepository('file', { name: 'manuals-repo' });
      const other = pluginRepository('file', { name: 'tools-repo' });
      const published = pluginPublication('file', {
        repository: other.pulp_href,
        repository_version: `${other.pulp_href}versions/0/`,
      });
      serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-repo',
              repository: repository.pulp_href,
            }),
            pluginDistribution('file', {
              name: 'by-pub',
              publication: published.pulp_href,
            }),
            pluginDistribution('file', {
              name: 'by-version',
              repository_version: `${repository.pulp_href}versions/0/`,
            }),
            pluginDistribution('file', { name: 'bare' }),
          ],
        },
        repositories: [repository, other],
        publications: { file: [published] },
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      const link = within(rowOf('by-repo')).getByRole('link', {
        name: 'manuals-repo',
      });
      expect(link.getAttribute('href')).toMatch(
        /^\/file\/repositories\/manuals-repo\/?$/,
      );
      expect(
        within(rowOf('by-pub')).getByText('Publication of version 0'),
      ).toBeVisible();
      expect(
        within(rowOf('by-version')).getByText('Version 0 (pinned)'),
      ).toBeVisible();
      expect(within(rowOf('bare')).getByText('Nothing')).toBeVisible();
    });

    it('names a repository the user may not read as one the user may not see, and links nothing', async () => {
      const hidden = pluginRepository('file', { name: 'hidden-repo' });
      serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-repo',
              repository: hidden.pulp_href,
            }),
          ],
        },
        repositories: [],
        publications: { file: [] },
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      const row = rowOf('by-repo');
      expect(
        within(row).getByText('A repository you may not see'),
      ).toBeVisible();
      // the only links of the row lead to the distribution, never to a
      // repository
      for (const link of within(row).queryAllByRole('link')) {
        expect(link.getAttribute('href')).not.toContain('/repositories/');
      }
    });

    it('shows the guard by name and type, marks a row with none as Public and a row with a guard the user may not see by that', async () => {
      const readable = contentGuard({ name: 'customers-only' });
      const unreadable = contentGuard({ name: 'secret' });
      serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'guarded',
              content_guard: readable.pulp_href,
            }),
            pluginDistribution('file', {
              name: 'hidden-guard',
              content_guard: unreadable.pulp_href,
            }),
            pluginDistribution('file', { name: 'open' }),
          ],
        },
        guards: [readable],
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      const guarded = rowOf('guarded');
      expect(within(guarded).getByText('customers-only (rbac)')).toBeVisible();
      expect(within(guarded).queryByText('Public')).not.toBeInTheDocument();
      // the URL of a guarded distribution says that downloads need credentials
      expect(
        within(guarded).getByText(/Downloads need credentials/),
      ).toBeVisible();

      const hidden = rowOf('hidden-guard');
      expect(
        within(hidden).getByText('A content guard you may not see'),
      ).toBeVisible();
      expect(within(hidden).queryByText('secret')).not.toBeInTheDocument();
      expect(within(hidden).queryByText('Public')).not.toBeInTheDocument();

      // a row with no guard is marked beside the guard and beside the URL
      const open = rowOf('open');
      expect(within(open).getAllByText('Public')).toHaveLength(2);
      expect(
        within(open).queryByText(/Downloads need credentials/),
      ).not.toBeInTheDocument();
    });

    it('tells from the publications whether a row serves, serves an older version or serves nothing', async () => {
      const fresh = pluginRepository('file', { name: 'fresh-repo' });
      const stale = pluginRepository('file', { name: 'stale-repo' });
      const none = pluginRepository('file', { name: 'none-repo' });
      const at = (repository: IRepository, version: number) => ({
        ...repository,
        latest_version_href: `${repository.pulp_href}versions/${version}/`,
      });
      const [freshRepo, staleRepo, noneRepo] = [
        at(fresh, 2),
        at(stale, 2),
        at(none, 1),
      ];
      const made = (repository: IRepository, version: number) =>
        pluginPublication('file', {
          repository: repository.pulp_href,
          repository_version: `${repository.pulp_href}versions/${version}/`,
        });
      const lab = serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'fresh',
              repository: freshRepo.pulp_href,
            }),
            pluginDistribution('file', {
              name: 'stale',
              repository: staleRepo.pulp_href,
            }),
            pluginDistribution('file', {
              name: 'nothing-published',
              repository: noneRepo.pulp_href,
            }),
            pluginDistribution('file', { name: 'unbound' }),
          ],
        },
        repositories: [freshRepo, staleRepo, noneRepo],
        publications: {
          file: [made(freshRepo, 2), made(staleRepo, 1)],
        },
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      expect(within(rowOf('fresh')).getByText('Served')).toBeVisible();
      expect(
        within(rowOf('stale')).getByText('Serves version 1, latest is 2'),
      ).toBeVisible();
      expect(
        within(rowOf('nothing-published')).getByText(
          'Serves nothing (404): no publication',
        ),
      ).toBeVisible();
      expect(
        within(rowOf('unbound')).getByText('Not bound to anything'),
      ).toBeVisible();
      // one index of the plugin's publications, whatever the number of rows
      expect(lab.index[0]?.queries).toHaveLength(1);
    });

    it('serves a distribution of a plugin that serves versions directly without any warning and reads no publications for it', async () => {
      const repository = pluginRepository('python', { name: 'wheels-repo' });
      const lab = serveBound({
        rows: {
          python: [
            pluginDistribution('python', {
              name: 'wheels',
              repository: repository.pulp_href,
            }),
          ],
        },
        repositories: [repository],
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      expect(within(rowOf('wheels')).getByText('Not applicable')).toBeVisible();
      expect(lab.index).toEqual([]);
    });

    it('says cannot be checked, and reads no publications, for a user who may not read the publications of the plugin', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.view_filedistribution']],
      });
      // the roles the user holds on single distributions are read for a user who
      // may not delete everywhere; this one holds none
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));
      const repository = pluginRepository('file', { name: 'manuals-repo' });
      const requests = recordRequests();
      const lab = serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-repo',
              repository: repository.pulp_href,
            }),
          ],
        },
        repositories: [repository],
        publications: { file: [] },
      });

      renderList();
      const table = await tableOf();
      await settled(table);
      requests.stop();

      expect(
        within(rowOf('by-repo')).getByText('Cannot be checked'),
      ).toBeVisible();
      expect(lab.index[0]?.queries).toHaveLength(0);
      expect(
        requests.all.filter((path) => /\/publications\//.test(path)),
      ).toEqual([]);
    });

    it('says cannot be checked because there are too many publications when a plugin is above the bound of the index', async () => {
      const repository = pluginRepository('file', { name: 'manuals-repo' });
      const rows = Array.from({ length: 12 }, () =>
        pluginPublication('file', {
          repository: repository.pulp_href,
          repository_version: `${repository.pulp_href}versions/0/`,
        }),
      );
      const lab = serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-repo',
              repository: repository.pulp_href,
            }),
          ],
        },
        repositories: [repository],
        publications: { file: rows },
        // a server that answers one publication to a request makes the bound
        // of ten pages reachable with a few rows
        publicationPageSize: 1,
      });

      const { user } = renderList();
      const table = await tableOf();
      await settled(table);

      expect(lab.index[0]?.queries).toHaveLength(10);
      const label = within(rowOf('by-repo')).getByText('Cannot be checked');
      await user.hover(label);
      expect(
        await screen.findByText('Too many publications to check here.'),
      ).toBeInTheDocument();
    });

    it('reads the publication index only of a plugin that has a row it is needed for', async () => {
      const published = pluginPublication('file');
      const lab = serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-pub',
              publication: published.pulp_href,
            }),
            pluginDistribution('file', { name: 'bare' }),
          ],
          maven: named('maven', 2),
        },
        publications: { file: [published] },
      });

      renderList();
      const table = await tableOf();
      await settled(table);

      expect(lab.index[0]?.queries).toHaveLength(0);
    });

    it('shows the rows and says which read failed when the publications cannot be read, and reads them again on request', async () => {
      const repository = pluginRepository('file', { name: 'manuals-repo' });
      serveBound({
        rows: {
          file: [
            pluginDistribution('file', {
              name: 'by-repo',
              repository: repository.pulp_href,
            }),
          ],
        },
        repositories: [repository],
        publications: { file: [] },
      });
      let failing = true;
      server.use(
        http.get(`*${API}/publications/file/file/`, () =>
          failing
            ? HttpResponse.json({ detail: 'Broken.' }, { status: 500 })
            : undefined,
        ),
      );

      const { user } = renderList();
      const table = await tableOf();

      await screen.findByText('Publications could not be read.', undefined, {
        timeout: 10_000,
      });
      expect(bodyRows(table)).toHaveLength(1);
      expect(within(rowOf('by-repo')).getByText('Not loaded')).toBeVisible();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(
          within(rowOf('by-repo')).getByText(
            'Serves nothing (404): no publication',
          ),
        ).toBeVisible(),
      );
    }, 30_000);

    describe('the requests of a load', () => {
      // `count` rows spread over four plugins, each bound to a repository of
      // its own that has one publication, and all guarded by one guard.
      function lab(count: number) {
        const guard = contentGuard({ name: 'shared' });
        const plugins = ['file', 'deb', 'rpm', 'python'] as const;
        const rows: Partial<Record<TestDistributionPlugin, IDistribution[]>> =
          {};
        const repositories: IRepository[] = [];
        const publications: Record<
          'file' | 'deb' | 'rpm',
          ReturnType<typeof pluginPublication>[]
        > = { file: [], deb: [], rpm: [] };

        plugins.forEach((plugin) => {
          rows[plugin] = [];
        });
        for (let n = 0; n < count; n++) {
          const plugin = plugins[
            n % plugins.length
          ] as (typeof plugins)[number];
          const repository = pluginRepository(plugin as TestPlugin);
          repositories.push(repository);
          const name = `${plugin}-${String(n).padStart(4, '0')}`;
          rows[plugin]?.push(
            pluginDistribution(plugin, {
              name,
              base_path: name,
              repository: repository.pulp_href,
              content_guard: guard.pulp_href,
            }),
          );
          if (plugin !== 'python') {
            publications[plugin].push(
              pluginPublication(plugin, {
                repository: repository.pulp_href,
                repository_version: `${repository.pulp_href}versions/0/`,
              }),
            );
          }
        }

        return serveBound({
          rows,
          repositories,
          publications,
          guards: [guard],
        });
      }

      it('costs at most 16 requests for 50 rows of four plugins and none to a single object or to the permissions of a user', async () => {
        lab(50);
        const requests = recordRequests();

        renderList();
        const table = await tableOf();
        await settled(table);
        requests.stop();

        expect(bodyRows(table)).toHaveLength(50);
        expect(requests.all.length).toBeLessThanOrEqual(16);
        expect(requests.all.filter((path) => SINGLE_OBJECT.test(path))).toEqual(
          [],
        );
      }, 60_000);

      it('costs at most 48 requests for 500 rows of four plugins and none to a single object or to the permissions of a user', async () => {
        lab(500);
        const requests = recordRequests();

        renderList('/distributions?page_size=500');
        const table = await tableOf();
        await settled(table);
        requests.stop();

        expect(bodyRows(table)).toHaveLength(500);
        expect(requests.all.length).toBeLessThanOrEqual(48);
        expect(requests.all.filter((path) => SINGLE_OBJECT.test(path))).toEqual(
          [],
        );
      }, 90_000);
    });
  },
);

describe(
  'Integration: creating a distribution from the list',
  { tags: ['integration'] },
  () => {
    const replaceAccount = (setup: Parameters<typeof servePermissions>[0]) => {
      permissions.stop();
      permissions = servePermissions({ id: 7, ...setup });
      // the roles on single distributions are read for a user without the
      // permission everywhere
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);
    };

    it('asks for the plugin first: every installed plugin the user may add to is offered, and the choice opens that plugin form', async () => {
      reportPlugins(['core', 'file', 'python', 'maven']);
      serveLab({ file: named('file', 2) });
      const { user } = renderList();

      await tableOf();
      await user.click(
        screen.getByRole('button', { name: 'Create distribution' }),
      );
      expect(
        screen
          .getAllByRole('menuitem')
          .map((item) => item.textContent)
          .sort(),
      ).toStrictEqual([
        'File distribution',
        'Maven distribution',
        'Python distribution',
      ]);

      await user.click(
        screen.getByRole('menuitem', { name: 'Python distribution' }),
      );

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/python/distribution/new',
      );
    });

    it('offers only the plugins whose add permission the user holds', async () => {
      replaceAccount({
        isStaff: false,
        own: [['python.add_pythondistribution', 'core.view_distribution']],
      });
      reportPlugins(['core', 'file', 'python']);
      serveLab({ file: named('file', 2) });
      const { user } = renderList();

      await tableOf();
      await user.click(
        screen.getByRole('button', { name: 'Create distribution' }),
      );

      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent),
      ).toStrictEqual(['Python distribution']);
    });

    it('offers no Create button to a user who may add no distribution of an installed plugin', async () => {
      replaceAccount({ isStaff: false, own: [['core.view_distribution']] });
      reportPlugins(['core', 'file']);
      serveLab({ file: named('file', 2) });
      renderList();

      await tableOf();

      expect(
        screen.queryByRole('button', { name: 'Create distribution' }),
      ).toBeNull();
    });

    it('offers Create on the empty list too', async () => {
      reportPlugins(['core', 'file']);
      serveLab({ file: [] });
      const { user } = renderList();

      await user.click(
        await screen.findByRole('button', { name: 'Create distribution' }),
      );
      await user.click(
        screen.getByRole('menuitem', { name: 'File distribution' }),
      );

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/distribution/new',
      );
    });
  },
);
