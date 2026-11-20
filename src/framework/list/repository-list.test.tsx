import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import fileDescriptor from 'src/descriptors/file/descriptor';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  type IRepository,
  distributionListHandler,
  listOf,
  page,
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  repositoryVersion,
  role,
  roleAssignment,
  taskListHandler,
  taskRow,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import {
  DEFAULT_PAGE_SIZE,
  DEFAULT_SORT,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from './list-params';
import { RepositoryList } from './repository-list';
import { type RowAction } from './row-actions';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

const OPTIONS = {
  sortable: ['name', 'pulp_created'],
  filters: ['name__icontains', 'pulp_label_select'],
};

describe('Unit: the list address', { tags: ['unit'] }, () => {
  it('lists fifty rows by name when the address names nothing', () => {
    expect(DEFAULT_PAGE_SIZE).toBe(50);
    expect(DEFAULT_SORT).toBe('name');
    expect(paramsOfAddress('', OPTIONS)).toEqual({
      page: 1,
      page_size: 50,
      sort: 'name',
    });
  });

  it('offers the page sizes 10 to 500', () => {
    expect(PAGE_SIZES).toEqual([10, 20, 50, 100, 200, 500]);
  });

  it('reads the page, its size and the order from the address', () => {
    expect(
      paramsOfAddress('?page=3&page_size=500&sort=-pulp_created', OPTIONS),
    ).toEqual({ page: 3, page_size: 500, sort: '-pulp_created' });
  });

  it.each(['0', '-5', 'many', '', '1.5', '501', '77', '9999999'])(
    'falls back to fifty rows for the page size %j',
    (size) => {
      expect(
        paramsOfAddress(`?page_size=${encodeURIComponent(size)}`, OPTIONS)
          .page_size,
      ).toBe(50);
    },
  );

  it.each(['0', '-1', 'x', '', '2.5'])(
    'falls back to the first page for the page %j',
    (page) => {
      expect(
        paramsOfAddress(`?page=${encodeURIComponent(page)}`, OPTIONS).page,
      ).toBe(1);
    },
  );

  it.each([
    'pulp_labels',
    'prn',
    '-pulp_labels',
    'name,pulp_created',
    '--name',
  ])(
    'falls back to the name for the order %j, which the server is not asked to sort by',
    (sort) => {
      expect(
        paramsOfAddress(`?sort=${encodeURIComponent(sort)}`, OPTIONS).sort,
      ).toBe('name');
    },
  );

  it('accepts a sortable field in either direction', () => {
    expect(paramsOfAddress('?sort=name', OPTIONS).sort).toBe('name');
    expect(paramsOfAddress('?sort=-name', OPTIONS).sort).toBe('-name');
    expect(paramsOfAddress('?sort=pulp_created', OPTIONS).sort).toBe(
      'pulp_created',
    );
  });

  it('reads only the filters the screen has, once each', () => {
    expect(
      paramsOfAddress(
        '?name__icontains=ab&name__icontains=cd&other=1&pulp_label_select=',
        OPTIONS,
      ),
    ).toEqual({
      page: 1,
      page_size: 50,
      sort: 'name',
      name__icontains: 'ab',
    });
  });

  it('writes an address that leaves out what is the default', () => {
    expect(searchOf({ page: 1, page_size: 50, sort: 'name' })).toBe('');
    expect(
      searchOf({
        page: 2,
        page_size: 500,
        sort: '-pulp_created',
        name__icontains: 'a b',
      }),
    ).toBe('?page=2&page_size=500&sort=-pulp_created&name__icontains=a%20b');
  });

  it('reads back what it wrote', () => {
    const params = {
      page: 4,
      page_size: 200,
      sort: '-name',
      pulp_label_select: 'team=a b',
    };
    expect(paramsOfAddress(searchOf(params), OPTIONS)).toEqual(params);
  });
});

// A lab of the plugin: every list the repository list reads, answered the way
// the server answers it.
interface Lab {
  repositories: IRepository[];
  distributions?: IDistribution[];
  publications?: ReturnType<typeof pluginPublication>[];
  versions?: ReturnType<typeof repositoryVersion>[];
  tasks?: ReturnType<typeof taskRow>[];
  // false: the server cannot read versions by address
  patched?: boolean;
}

function serveLab({
  repositories,
  distributions = [],
  publications = [],
  versions = [],
  tasks = [],
  patched = true,
}: Lab) {
  const lab = {
    repositories: pluginListHandler('file', 'repository', repositories, {
      pageSize: 1000,
    }),
    distributions: distributionListHandler('file', distributions),
    publications: publicationListHandler('file', publications),
    versions: versionSummaryHandler({ patched, versions }),
    tasks: taskListHandler(tasks),
  };
  server.use(
    lab.repositories.handler,
    lab.distributions.handler,
    lab.publications.handler,
    lab.versions.handler,
    lab.tasks.handler,
  );
  return lab;
}

function Where() {
  const { pathname, search } = useLocation();

  return <p data-testid='location'>{`${pathname}${search}`}</p>;
}

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

// What the permission helpers of a test recorded, to be stopped afterwards. A
// test that needs another account serves it with `serveAccount`; the last one
// served answers.
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
  resetSessionEvents();
});

function renderList(route = '/file/repositories') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const named = (count: number, from = 1) =>
  Array.from({ length: count }, (_, n) =>
    pluginRepository('file', {
      name: `repo-${String(from + n).padStart(4, '0')}`,
    }),
  );

const withSummary = (repository: IRepository, count: number) =>
  repositoryVersion(repository, 0, {
    content_summary: {
      added: {},
      removed: {},
      present: { 'file.file': { count, href: `${API}/content/file/files/` } },
    },
  });

const tableOf = () => screen.findByRole('grid', { name: 'Repositories' });

const bodyRows = (table: HTMLElement) =>
  Array.from(table.querySelectorAll('tbody tr')) as HTMLElement[];

const rowOf = (name: string) =>
  screen.getByRole('link', { name }).closest('tr') as HTMLElement;

// Every request of the page the list itself sends: not the sign-in, the plugin
// list or the reads of the user's own roles, which belong to the session.
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
    all,
    own: () =>
      all.filter(
        (path) =>
          !/^\/pulp\/api\/v3\/(login|status|users|groups|roles)\//.test(path),
      ),
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

// An address of one object: a repository, distribution, publication, task or
// remote by its id, or one version of a repository.
const SINGLE_OBJECT =
  /\/(repositories|distributions|publications|remotes|tasks)\/[a-z_]+(\/[a-z_]+)?\/[0-9a-f-]{36}\/|\/versions\/\d+\/|my_permissions/;

describe('Integration: the repository list', { tags: ['integration'] }, () => {
  it('reads one page of fifty by name and shows each row with its link, labels and created date', async () => {
    const repositories = [
      pluginRepository('file', {
        name: 'docs',
        pulp_labels: { team: 'docs', tier: null },
        pulp_created: '2024-03-01T10:00:00.000000Z',
      }),
      ...named(59),
    ];
    const lab = serveLab({ repositories });

    renderList();
    const table = await tableOf();

    expect(lab.repositories.queries).toHaveLength(1);
    const query = lab.repositories.queries[0] as URLSearchParams;
    expect(query.get('limit')).toBe('50');
    expect(query.get('offset')).toBe('0');
    expect(query.get('ordering')).toBe('name');
    // the list asks for the fields its columns read, and nothing else
    const fields = query.getAll('fields').flatMap((f) => f.split(','));
    expect(fields).toEqual(
      expect.arrayContaining([
        'pulp_href',
        'name',
        'prn',
        'latest_version_href',
        'pulp_labels',
        'pulp_created',
      ]),
    );
    expect(fields).not.toContain('description');
    expect(bodyRows(table)).toHaveLength(50);

    const link = screen.getByRole('link', { name: 'docs' });
    expect(link.getAttribute('href')).toMatch(
      /^\/file\/repositories\/docs\/?$/,
    );
    const row = rowOf('docs');
    expect(within(row).getByText('team: docs')).toBeVisible();
    expect(within(row).getByText('tier')).toBeVisible();
    expect(row.querySelector('time')).toHaveAttribute(
      'datetime',
      '2024-03-01T10:00:00.000000Z',
    );
  });

  it('reads a page of 500 when the address asks for it', async () => {
    const lab = serveLab({ repositories: named(520) });

    renderList('/file/repositories?page_size=500');
    const table = await tableOf();

    expect(lab.repositories.queries[0]?.get('limit')).toBe('500');
    expect(bodyRows(table)).toHaveLength(500);
  }, 60_000);

  it('reads the page and order of the address and keeps them there when the page is changed', async () => {
    const lab = serveLab({ repositories: named(30) });

    const { user } = renderList(
      '/file/repositories?page=2&page_size=10&sort=-pulp_created',
    );
    const table = await tableOf();

    const query = lab.repositories.queries[0] as URLSearchParams;
    expect(query.get('offset')).toBe('10');
    expect(query.get('limit')).toBe('10');
    expect(query.get('ordering')).toBe('-pulp_created');
    expect(bodyRows(table)).toHaveLength(10);

    await user.click(screen.getAllByRole('button', { name: /next page/i })[0]);

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/file/repositories?page=3&page_size=10&sort=-pulp_created',
      ),
    );
  });

  it('keeps the order in the address when a column is sorted', async () => {
    const lab = serveLab({ repositories: named(5) });

    const { user } = renderList();
    await tableOf();

    const sort = document.querySelector(
      '[data-cy="sort_pulp_created"]',
    ) as HTMLElement;
    await user.click(sort);

    await waitFor(() =>
      expect(lab.repositories.queries.at(-1)?.get('ordering')).toMatch(
        /pulp_created/,
      ),
    );
    expect(screen.getByTestId('location').textContent).toMatch(
      /sort=-?pulp_created/,
    );
  });

  it('sends only the page sizes and sort fields it offers', async () => {
    const lab = serveLab({ repositories: named(5) });

    renderList('/file/repositories?page_size=100000&sort=-pulp_labels');
    await tableOf();

    const query = lab.repositories.queries[0] as URLSearchParams;
    expect(query.get('limit')).toBe('50');
    expect(query.get('ordering')).toBe('name');
  });

  it('offers a sort control on the name and the created date only', async () => {
    serveLab({ repositories: named(3) });

    renderList();
    const table = await tableOf();

    expect(
      Array.from(table.querySelectorAll('[data-cy^="sort_"]')).map((icon) =>
        icon.getAttribute('data-cy'),
      ),
    ).toEqual(['sort_name', 'sort_pulp_created']);
    for (const header of [
      'Base URL',
      'Latest version',
      'Content',
      'Last task',
    ]) {
      expect(
        within(table).getByRole('columnheader', { name: header }),
      ).toBeVisible();
    }
  });

  it('shows the page of per-page choices up to 500', async () => {
    serveLab({ repositories: named(3) });

    const { user } = renderList();
    await tableOf();

    await user.click(screen.getAllByRole('button', { name: /^1 - \d+ of/ })[0]);
    const choices = (await screen.findAllByRole('menuitem')).map((item) =>
      item.textContent?.replace(/\D+/g, ''),
    );
    expect(choices).toEqual(['10', '20', '50', '100', '200', '500']);
  });

  it('fills the base URL, latest version, content count and last task from the indexes', async () => {
    const [served, bound, plain, busy] = named(4);
    const repositories = [served, bound, plain, busy] as ReturnType<
      typeof pluginRepository
    >[];
    const publication = pluginPublication('file', {
      repository: bound?.pulp_href,
    });
    const lab = serveLab({
      repositories,
      distributions: [
        pluginDistribution('file', {
          base_path: 'direct',
          base_url: 'https://pulp.example/pulp/content/direct/',
          repository: served?.pulp_href,
        }),
        pluginDistribution('file', {
          base_path: 'published',
          base_url: 'https://pulp.example/pulp/content/published/',
          publication: publication.pulp_href,
        }),
      ],
      publications: [publication],
      versions: [
        withSummary(served as IRepository, 4),
        withSummary(bound as IRepository, 0),
        withSummary(plain as IRepository, 12),
        withSummary(busy as IRepository, 3),
      ],
      tasks: [
        taskRow({
          name: 'pulpcore.app.tasks.base.general_update',
          state: 'completed',
          pulp_created: '2024-01-01T00:00:00.000000Z',
          reserved_resources_record: [
            `shared:${(served as IRepository)['prn'] as string}`,
          ],
        }),
        taskRow({
          state: 'running',
          pulp_created: '2024-01-02T00:00:00.000000Z',
          reserved_resources_record: [
            (busy as IRepository)['prn'] as string,
            'shared:prn:core.domain:1',
          ],
        }),
      ],
    });

    renderList();
    const table = await tableOf();
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );

    expect(
      within(rowOf(served?.name as string)).getByText(
        'https://pulp.example/pulp/content/direct/',
      ),
    ).toBeVisible();
    expect(
      within(rowOf(bound?.name as string)).getByText(
        'https://pulp.example/pulp/content/published/',
      ),
    ).toBeVisible();
    expect(
      within(rowOf(plain?.name as string)).getByText('Not served'),
    ).toBeVisible();

    // the latest version is the number of the address, with no request
    expect(within(rowOf(served?.name as string)).getByText('0')).toBeVisible();
    expect(within(rowOf(served?.name as string)).getByText('4')).toBeVisible();
    expect(within(rowOf(plain?.name as string)).getByText('12')).toBeVisible();

    expect(
      within(rowOf(served?.name as string)).getByText('Completed'),
    ).toBeVisible();
    expect(
      within(rowOf(busy?.name as string)).getByText('Running'),
    ).toBeVisible();
    expect(
      within(rowOf(plain?.name as string)).getByText('No recent task'),
    ).toBeVisible();
    expect(lab.versions.queries).toHaveLength(1);
  });

  it('links the last task to its own page', async () => {
    const [repository] = named(1) as IRepository[];
    const finished = taskRow({
      reserved_resources_record: [(repository as IRepository)['prn'] as string],
    });
    serveLab({ repositories: [repository as IRepository], tasks: [finished] });

    renderList();
    await tableOf();

    const row = rowOf((repository as IRepository).name);
    const link = await within(row).findByRole('link', { name: /Completed/ });
    expect(link.getAttribute('href')).toMatch(
      new RegExp(
        `^/tasks/${finished.pulp_href.split('/').filter(Boolean).pop()}/?$`,
      ),
    );
  });

  it('shows a column whose read failed as its own error with Retry, while the other columns and the rows stay', async () => {
    const [first, second] = named(2) as IRepository[];
    const lab = serveLab({
      repositories: [first as IRepository, second as IRepository],
      distributions: [
        pluginDistribution('file', {
          base_path: 'direct',
          base_url: 'https://pulp.example/pulp/content/direct/',
          repository: first?.pulp_href,
        }),
      ],
      versions: [
        withSummary(first as IRepository, 7),
        withSummary(second as IRepository, 8),
      ],
    });
    server.use(
      http.get(`*${lab.distributions.path}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    const { user } = renderList();
    const table = await tableOf();
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );

    // rows and the other columns are shown
    expect(
      screen.getByRole('link', { name: (first as IRepository).name }),
    ).toBeVisible();
    expect(
      within(rowOf((first as IRepository).name)).getByText('7'),
    ).toBeVisible();
    // the failed column says so once, with a Retry that reads it again
    const alert = await screen.findByText(/Base URLs could not be read/);
    expect(alert).toBeVisible();
    expect(
      within(rowOf((first as IRepository).name)).queryByText('Not served'),
    ).toBeNull();

    // the server answers again
    server.use(lab.distributions.handler);
    const retry = within(
      alert.closest('.pf-v6-c-alert') as HTMLElement,
    ).getByRole('button', { name: 'Retry' });
    await user.click(retry);

    expect(
      await within(rowOf((first as IRepository).name)).findByText(
        'https://pulp.example/pulp/content/direct/',
      ),
    ).toBeVisible();
    expect(screen.queryByText(/Base URLs could not be read/)).toBeNull();
  });

  it('shows Not available as the content count and sends no further version request when the server cannot read versions by address', async () => {
    const repositories = named(100) as IRepository[];
    const lab = serveLab({
      repositories,
      versions: repositories.map((row) => withSummary(row, 1)),
      patched: false,
    });

    renderList('/file/repositories?page_size=100');
    const table = await tableOf();
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );

    const row = rowOf((repositories[0] as IRepository).name);
    expect(within(row).getByText('Not available')).toBeVisible();
    expect(lab.versions.queries).toHaveLength(1);
  }, 30_000);

  it('marks the rows and then the derived columns as loaded, so a measurement can time them', async () => {
    const repositories = named(3) as IRepository[];
    serveLab({ repositories });

    renderList();
    const table = await tableOf();

    expect(table).toHaveAttribute('data-rows-loaded', 'true');
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );
  });

  it('sends a bounded number of requests for fifty rows, none to a single object and none for permissions', async () => {
    const repositories = named(50) as IRepository[];
    serveLab({
      repositories,
      distributions: repositories.map((row, n) =>
        pluginDistribution('file', {
          base_path: `d-${n}`,
          repository: row.pulp_href,
        }),
      ),
      versions: repositories.map((row) => withSummary(row, 2)),
      tasks: repositories.map((row) =>
        taskRow({ reserved_resources_record: [row['prn'] as string] }),
      ),
    });
    const requests = recordRequests();

    renderList();
    const table = await tableOf();
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );
    requests.stop();

    const own = requests.own();
    expect(own.length).toBeLessThanOrEqual(12);
    expect(own.filter((path) => SINGLE_OBJECT.test(path))).toEqual([]);
  }, 30_000);

  it('sends a bounded number of requests for 500 rows that does not grow with the rows', async () => {
    const repositories = named(500) as IRepository[];
    serveLab({
      repositories,
      distributions: repositories.map((row, n) =>
        pluginDistribution('file', {
          base_path: `d-${n}`,
          repository: row.pulp_href,
        }),
      ),
      versions: repositories.map((row) => withSummary(row, 2)),
      tasks: repositories.map((row) =>
        taskRow({ reserved_resources_record: [row['prn'] as string] }),
      ),
    });
    const requests = recordRequests();

    renderList('/file/repositories?page_size=500');
    const table = await tableOf();
    await waitFor(
      () => expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      { timeout: 40_000 },
    );
    requests.stop();

    expect(bodyRows(table)).toHaveLength(500);
    const own = requests.own();
    expect(own.length).toBeLessThanOrEqual(40);
    expect(own.filter((path) => SINGLE_OBJECT.test(path))).toEqual([]);
  }, 90_000);

  it('shows the first-read error with Retry, never an empty list', async () => {
    serveLab({ repositories: [] });
    let answer = 500;
    server.use(
      http.get(`*${API}/repositories/file/file/`, () =>
        answer === 500
          ? HttpResponse.json({ detail: 'boom' }, { status: 500 })
          : HttpResponse.json({
              count: 0,
              next: null,
              previous: null,
              results: [],
            }),
      ),
    );

    const { user } = renderList();

    expect(
      await screen.findByText('Repositories could not be displayed.'),
    ).toBeVisible();
    expect(screen.queryByText('No repositories yet')).toBeNull();

    answer = 200;
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(await screen.findByText('No repositories yet')).toBeVisible();
  });

  it('shows the insufficient permissions page with the reason when the list read is refused', async () => {
    serveLab({ repositories: [] });
    server.use(
      http.get(`*${API}/repositories/file/file/`, () =>
        HttpResponse.json({ detail: 'No way.' }, { status: 403 }),
      ),
    );

    renderList();

    expect(await screen.findByText(/No way\./)).toBeVisible();
  });
});

// The actions a user may take on the list, decided by the permissions the
// screen is told about and nothing else: an action the user cannot be
// confirmed to hold is absent, never disabled and never refused.
describe(
  'Integration: the actions of the repository list',
  { tags: ['integration'] },
  () => {
    const ADD = 'file.add_filerepository';
    const CHANGE = 'file.change_filerepository';
    const DELETE = 'file.delete_filerepository';
    const SYNC = 'file.sync_filerepository';
    const OWNER = 'file.filerepository_owner';

    // The signed-in user holds these permissions on every repository.
    const holding = (...permissions: string[]) =>
      serveAccount({ isStaff: false, own: [permissions] });

    // The roles the user holds on single repositories and what each role allows,
    // as the server lists them. `held` may answer later than the rows.
    function serveRolesOnObjects(
      grants: IRepository[],
      {
        held = Promise.resolve(),
        catalogueStatus = 200,
        // what the user holds on every repository
        everywhere = [] as string[],
      } = {},
    ) {
      const assignments = [
        ...grants.map((repository) =>
          roleAssignment(OWNER, repository.pulp_href),
        ),
        ...(everywhere.length > 0
          ? [roleAssignment('global', null, { permissions: everywhere })]
          : []),
      ];
      const own = listOf(`${API}/users/7/roles/`, assignments, {
        pageSize: 1000,
        matching: (row, query) =>
          query.get('content_object') !== 'null' || row.content_object === null,
        projected: projectedBy,
      });
      server.use(
        own.handler,
        http.get(`*${API}/roles/`, async () => {
          await held;
          return catalogueStatus === 200
            ? HttpResponse.json(
                page([role({ name: OWNER, permissions: [CHANGE] })]),
              )
            : HttpResponse.json({ detail: 'broken' }, { status: 500 });
        }),
      );
      return { own };
    }

    const kebabOf = (row: HTMLElement) =>
      within(row).queryByRole('button', { name: /actions|kebab/i });

    it('shows Add repository only to a user who holds the add permission, and leads to the create address', async () => {
      holding(ADD);
      serveLab({ repositories: named(2) });
      serveRolesOnObjects([], { everywhere: [ADD] });

      const { user } = renderList();
      await tableOf();

      await user.click(screen.getByRole('button', { name: 'Add repository' }));
      expect(screen.getByTestId('location').textContent).toBe(
        '/file/repository/new/',
      );
    });

    it('shows no Add repository to a user who does not hold the add permission', async () => {
      holding(CHANGE);
      serveLab({ repositories: named(2) });
      serveRolesOnObjects([]);

      renderList();
      await tableOf();

      expect(
        screen.queryByRole('button', { name: 'Add repository' }),
      ).toBeNull();
    });

    it('offers Edit on every row to a user who holds the change, delete and sync permissions, without reading the roles on single objects', async () => {
      holding(CHANGE, DELETE, SYNC);
      const repositories = named(3) as IRepository[];
      serveLab({ repositories });
      const requests = recordRequests();

      const { user } = renderList();
      const table = await tableOf();
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );
      for (const repository of repositories) {
        expect(kebabOf(rowOf(repository.name))).not.toBeNull();
      }
      // no read of the catalogue of roles or of single assignments
      requests.stop();
      expect(
        requests.all.filter((path) => /\/roles\/\?.*fields=/.test(path)),
      ).toEqual([]);

      const row = rowOf((repositories[0] as IRepository).name);
      await user.click(kebabOf(row) as HTMLElement);
      await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

      expect(screen.getByTestId('location').textContent).toBe(
        `/file/repositories/${(repositories[0] as IRepository).name}/edit/`,
      );
    });

    it('offers Edit on the rows the user holds the change permission on, found in the roles on single objects', async () => {
      holding();
      const repositories = named(3) as IRepository[];
      serveLab({ repositories });
      serveRolesOnObjects([repositories[1] as IRepository]);

      renderList();
      await tableOf();

      await waitFor(() =>
        expect(
          kebabOf(rowOf((repositories[1] as IRepository).name)),
        ).not.toBeNull(),
      );
      expect(kebabOf(rowOf((repositories[0] as IRepository).name))).toBeNull();
      expect(kebabOf(rowOf((repositories[2] as IRepository).name))).toBeNull();
    });

    it('shows no action and no spinner while the roles on single objects are not known yet', async () => {
      holding();
      const repositories = named(2) as IRepository[];
      serveLab({ repositories });
      let release: () => void = () => undefined;
      serveRolesOnObjects([repositories[0] as IRepository], {
        held: new Promise<void>((resolve) => {
          release = resolve;
        }),
      });

      renderList();
      const table = await tableOf();
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );

      expect(kebabOf(rowOf((repositories[0] as IRepository).name))).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('Insufficient permissions')).toBeNull();

      await act(async () => release());
      await waitFor(() =>
        expect(
          kebabOf(rowOf((repositories[0] as IRepository).name)),
        ).not.toBeNull(),
      );
    });

    it('offers a Retry, and no refusal and no spinner, when the permissions could not be read, and offers the actions once they can', async () => {
      const repositories = named(2) as IRepository[];
      serveLab({ repositories });
      server.use(
        http.get(`*${API}/users/7/`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const { user } = renderWithProviders(
        <AppContextProvider>
          <Routed />
        </AppContextProvider>,
        { route: '/file/repositories' },
      );
      await tableOf();

      expect(
        await screen.findByText('Your permissions could not be read'),
      ).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Add repository' }),
      ).toBeNull();
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('Insufficient permissions')).toBeNull();
      expect(screen.queryByText(/do not have permission/)).toBeNull();

      // the server answers again
      serveAccount({ isStaff: true });
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(
        await screen.findByRole('button', { name: 'Add repository' }),
      ).toBeVisible();
      expect(
        screen.queryByText('Your permissions could not be read'),
      ).toBeNull();
    });

    it('offers a Retry, and shows no action on a guess, when the roles on single objects could not be read', async () => {
      holding();
      const repositories = named(2) as IRepository[];
      serveLab({ repositories });
      serveRolesOnObjects([repositories[0] as IRepository], {
        catalogueStatus: 500,
      });

      renderList();
      await tableOf();

      expect(
        await screen.findByText('Your permissions could not be read'),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
      expect(kebabOf(rowOf((repositories[0] as IRepository).name))).toBeNull();
      expect(screen.queryByText('Insufficient permissions')).toBeNull();
    });

    it('takes the actions of later screens with the permission names of their own', async () => {
      holding(SYNC);
      const repositories = named(2) as IRepository[];
      serveLab({ repositories });
      const sync: RowAction<RepositoryBase> = {
        id: 'sync',
        permission: 'sync',
        item: (row) => <span>{`Sync ${row.name}`}</span>,
      };
      const never: RowAction<RepositoryBase> = {
        id: 'never',
        permission: 'sync',
        appliesTo: () => false,
        item: () => <span>Never</span>,
      };

      const { user } = renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <RepositoryList
              plugin='file'
              descriptor={fileDescriptor}
              actions={[sync, never]}
            />
          </PermissionsKnown>
        </AppContextProvider>,
      );
      await tableOf();

      const row = rowOf((repositories[0] as IRepository).name);
      await user.click(kebabOf(row) as HTMLElement);
      expect(
        await screen.findByText(
          `Sync ${(repositories[0] as IRepository).name}`,
        ),
      ).toBeVisible();
      // Edit is not offered here: the change permission is not held
      expect(screen.queryByRole('menuitem', { name: 'Edit' })).toBeNull();
      expect(screen.queryByText('Never')).toBeNull();
    });

    it('shows no repositories yet with the add button for a user who may add one', async () => {
      holding(ADD);
      serveLab({ repositories: [] });

      renderList();

      expect(await screen.findByText('No repositories yet')).toBeVisible();
      expect(
        screen.getByRole('button', { name: 'Add repository' }),
      ).toBeVisible();
    });

    it('shows no repositories yet without an add button for a user who may not add one', async () => {
      holding(CHANGE);
      serveLab({ repositories: [] });

      renderList();

      expect(await screen.findByText('No repositories yet')).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Add repository' }),
      ).toBeNull();
    });

    it('shows the filtered empty state with Clear all filters when a filter matches nothing', async () => {
      serveLab({ repositories: named(3) });
      const filtered = {
        ...fileDescriptor,
        repository: {
          ...fileDescriptor.repository,
          filters: [
            {
              id: 'name',
              label: { id: 'Repository name' },
              param: 'name__icontains',
              kind: 'text' as const,
            },
          ],
        },
      };

      const { user } = renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <Where />
            <RepositoryList plugin='file' descriptor={filtered} />
          </PermissionsKnown>
        </AppContextProvider>,
        { route: '/file/repositories?name__icontains=nothing-like-it' },
      );

      expect(await screen.findByText('No results found')).toBeVisible();
      expect(screen.queryByText('No repositories yet')).toBeNull();
      const empty = screen
        .getByText('No results found')
        .closest('.pf-v6-c-empty-state') as HTMLElement;
      await user.click(
        within(empty).getByRole('button', { name: 'Clear all filters' }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          '/file/repositories',
        ),
      );
    });
  },
);
