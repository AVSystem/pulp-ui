import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { AlertList } from 'src/components';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRemote,
  type IRepository,
  listOf,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { repositoryListPath } from '../route-patterns';
import { frameworkRoutes } from '../routes';
import {
  WatchedTasksProvider,
  useWatchedAnnouncements,
} from '../watched-tasks';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

// A lab of the plugin: the remotes the list reads and the repositories the used
// by column is found from, answered the way the server answers them.
function serveLab({
  remotes,
  repositories = [],
}: {
  remotes: IRemote[];
  repositories?: IRepository[];
}) {
  const lab = {
    remotes: pluginListHandler('file', 'remote', remotes, { pageSize: 1000 }),
    repositories: pluginListHandler('file', 'repository', repositories, {
      pageSize: 1000,
    }),
  };
  server.use(
    lab.remotes.handler,
    lab.repositories.handler,
    // the roles an account that holds permissions on single objects is read
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return lab;
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

function renderList(route = '/file/remotes') {
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
    pluginRemote('file', {
      name: `remote-${String(from + n).padStart(4, '0')}`,
    }),
  );

const tableOf = () => screen.findByRole('grid', { name: 'Remotes' });

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

describe('Integration: the remote list', { tags: ['integration'] }, () => {
  it('reads one page of fifty by name and shows each row with its link, URL, download policy, labels and created date', async () => {
    const remotes = [
      pluginRemote('file', {
        name: 'mirror',
        url: 'https://pulp.example/index/',
        policy: 'on_demand',
        pulp_labels: { team: 'docs', tier: null },
        pulp_created: '2024-03-01T10:00:00.000000Z',
      }),
      ...named(59),
    ];
    const lab = serveLab({ remotes });

    renderList();
    const table = await tableOf();

    expect(lab.remotes.queries).toHaveLength(1);
    const query = lab.remotes.queries[0] as URLSearchParams;
    expect(query.get('limit')).toBe('50');
    expect(query.get('offset')).toBe('0');
    expect(query.get('ordering')).toBe('name');
    // the list asks for the fields its columns read, and nothing else
    const fields = query.getAll('fields').flatMap((f) => f.split(','));
    expect(fields).toEqual(
      expect.arrayContaining([
        'pulp_href',
        'name',
        'url',
        'policy',
        'pulp_labels',
        'pulp_created',
      ]),
    );
    expect(bodyRows(table)).toHaveLength(50);

    const row = rowOf('mirror');
    expect(screen.getByRole('link', { name: 'mirror' })).toHaveAttribute(
      'href',
      '/file/remotes/mirror/',
    );
    expect(within(row).getByText('https://pulp.example/index/')).toBeVisible();
    expect(within(row).getByText('On demand')).toBeVisible();
    expect(within(row).getByText('team: docs')).toBeVisible();
    expect(within(row).getByText('tier')).toBeVisible();
    for (const header of [
      'Remote name',
      'URL',
      'Download policy',
      'Labels',
      'Created date',
      'Used by',
    ]) {
      expect(
        within(table).getByRole('columnheader', { name: header }),
      ).toBeVisible();
    }
  });

  it('lists the repositories that use each remote from one read of the repository index', async () => {
    const [first, second, unused] = named(3) as IRemote[];
    const repositories = [
      pluginRepository('file', {
        name: 'docs',
        remote: (first as IRemote).pulp_href,
      }),
      pluginRepository('file', {
        name: 'manuals',
        remote: (first as IRemote).pulp_href,
      }),
      pluginRepository('file', {
        name: 'tools',
        remote: (second as IRemote).pulp_href,
      }),
      pluginRepository('file', { name: 'standalone' }),
    ];
    const lab = serveLab({
      remotes: [first as IRemote, second as IRemote, unused as IRemote],
      repositories,
    });

    renderList();
    await tableOf();

    const used = rowOf((first as IRemote).name);
    expect(
      await within(used).findByRole('link', { name: 'docs' }),
    ).toHaveAttribute('href', '/file/repositories/docs/');
    expect(within(used).getByRole('link', { name: 'manuals' })).toBeVisible();
    expect(within(used).queryByRole('link', { name: 'tools' })).toBeNull();
    expect(
      within(rowOf((second as IRemote).name)).getByRole('link', {
        name: 'tools',
      }),
    ).toBeVisible();
    expect(
      within(rowOf((unused as IRemote).name)).getByText('Not used'),
    ).toBeVisible();
    expect(screen.queryByText('standalone')).toBeNull();
    // one read of the index for the whole list, however many remotes it holds
    expect(lab.repositories.queries).toHaveLength(1);
    expect(lab.repositories.queries[0]?.get('limit')).toBe('1000');
  });

  it('names the first few users of a remote and leads to the repositories filtered by it for the rest', async () => {
    const [shared] = named(1) as IRemote[];
    const repositories = ['a', 'b', 'c', 'd', 'e'].map((name) =>
      pluginRepository('file', {
        name: `repo-${name}`,
        remote: (shared as IRemote).pulp_href,
      }),
    );
    serveLab({ remotes: [shared as IRemote], repositories });

    renderList();
    await tableOf();

    const row = rowOf((shared as IRemote).name);
    expect(
      await within(row).findByRole('link', { name: 'repo-a' }),
    ).toBeVisible();
    expect(within(row).getByRole('link', { name: 'repo-c' })).toBeVisible();
    expect(within(row).queryByRole('link', { name: 'repo-d' })).toBeNull();
    const more = within(row).getByRole('link', { name: '+2 more' });
    expect(more.getAttribute('href')).toBe(
      `${repositoryListPath('file')}?remote=${encodeURIComponent((shared as IRemote).pulp_href)}`,
    );
  });

  it('reads the page, order and filters of the address and keeps them there when a column is sorted', async () => {
    const lab = serveLab({
      remotes: named(5).map((remote) => ({
        ...remote,
        pulp_labels: { team: 'docs' },
      })),
    });

    const { user } = renderList(
      '/file/remotes?page_size=10&sort=-url&name__icontains=remote&pulp_label_select=team%3Ddocs',
    );
    await tableOf();

    const query = lab.remotes.queries[0] as URLSearchParams;
    expect(query.get('limit')).toBe('10');
    expect(query.get('ordering')).toBe('-url');
    expect(query.get('name__icontains')).toBe('remote');
    expect(query.get('pulp_label_select')).toBe('team=docs');

    await user.click(
      document.querySelector('[data-cy="sort_pulp_created"]') as HTMLElement,
    );

    await waitFor(() =>
      expect(lab.remotes.queries.at(-1)?.get('ordering')).toMatch(
        /pulp_created/,
      ),
    );
    expect(screen.getByTestId('location').textContent).toMatch(
      /page_size=10&sort=-?pulp_created&name__icontains=remote&pulp_label_select=team%3Ddocs/,
    );
  });

  it('offers a sort control on the name, URL and created date only', async () => {
    serveLab({ remotes: named(3) });

    renderList();
    const table = await tableOf();

    expect(
      Array.from(table.querySelectorAll('[data-cy^="sort_"]')).map((icon) =>
        icon.getAttribute('data-cy'),
      ),
    ).toEqual(['sort_name', 'sort_url', 'sort_pulp_created']);
  });

  it('sends only the page sizes and sort fields it offers', async () => {
    const lab = serveLab({ remotes: named(5) });

    renderList('/file/remotes?page_size=100000&sort=-policy');
    await tableOf();

    const query = lab.remotes.queries[0] as URLSearchParams;
    expect(query.get('limit')).toBe('50');
    expect(query.get('ordering')).toBe('name');
  });

  it('sends a bounded number of requests for fifty rows, none to a single object and none for permissions', async () => {
    const remotes = named(50) as IRemote[];
    const lab = serveLab({
      remotes,
      repositories: remotes.map((remote, n) =>
        pluginRepository('file', {
          name: `repo-${n}`,
          remote: remote.pulp_href,
        }),
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
    expect(own.length).toBeLessThanOrEqual(3);
    expect(own.filter((path) => SINGLE_OBJECT.test(path))).toEqual([]);
    expect(lab.repositories.queries).toHaveLength(1);
  });

  it('sends the same bounded number of requests for 500 rows, which does not grow with the rows', async () => {
    const remotes = named(520) as IRemote[];
    const lab = serveLab({
      remotes,
      repositories: remotes.map((remote, n) =>
        pluginRepository('file', {
          name: `repo-${String(n).padStart(4, '0')}`,
          remote: remote.pulp_href,
        }),
      ),
    });
    const requests = recordRequests();

    renderList('/file/remotes?page_size=500');
    const table = await tableOf();
    await waitFor(
      () => expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      { timeout: 40_000 },
    );
    requests.stop();

    expect(bodyRows(table)).toHaveLength(500);
    const own = requests.own();
    expect(lab.remotes.queries[0]?.get('limit')).toBe('500');
    expect(own.length).toBeLessThanOrEqual(3);
    expect(own.filter((path) => SINGLE_OBJECT.test(path))).toEqual([]);
    expect(lab.repositories.queries).toHaveLength(1);
  }, 90_000);

  it('marks the rows and then the used by column as loaded, so a measurement can time them', async () => {
    serveLab({ remotes: named(3), repositories: [] });

    renderList();
    const table = await tableOf();

    expect(table).toHaveAttribute('data-rows-loaded', 'true');
    await waitFor(() =>
      expect(table).toHaveAttribute('data-columns-loaded', 'true'),
    );
  });

  it('shows the used by column as its own error with Retry while the rows and the other columns stay', async () => {
    const [remote] = named(1) as IRemote[];
    const repository = pluginRepository('file', {
      name: 'docs',
      remote: (remote as IRemote).pulp_href,
    });
    const lab = serveLab({
      remotes: [remote as IRemote],
      repositories: [repository],
    });
    server.use(
      http.get(`*${lab.repositories.path}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    const { user } = renderList();
    await tableOf();

    const alert = await screen.findByText(
      /Repositories using the remotes could not be read/,
    );
    expect(
      screen.getByRole('link', { name: (remote as IRemote).name }),
    ).toBeVisible();
    expect(
      within(rowOf((remote as IRemote).name)).queryByText('Not used'),
    ).toBeNull();

    server.use(lab.repositories.handler);
    await user.click(
      within(alert.closest('.pf-v6-c-alert') as HTMLElement).getByRole(
        'button',
        { name: 'Retry' },
      ),
    );

    expect(
      await within(rowOf((remote as IRemote).name)).findByRole('link', {
        name: 'docs',
      }),
    ).toBeVisible();
    expect(
      screen.queryByText(/Repositories using the remotes could not be read/),
    ).toBeNull();
  });

  it('goes to the last page that has rows when the address is past the end, and never says there are no remotes', async () => {
    serveLab({ remotes: named(11) });

    renderList('/file/remotes?page=9&page_size=10');

    const table = await tableOf();
    expect(bodyRows(table)).toHaveLength(1);
    expect(screen.getByTestId('location').textContent).toBe(
      '/file/remotes?page=2&page_size=10',
    );
    expect(screen.queryByText('No remotes yet')).toBeNull();
  });

  it('shows no remotes yet only when the server counts none', async () => {
    serveLab({ remotes: [] });

    renderList('/file/remotes?page=3&page_size=10');

    expect(await screen.findByText('No remotes yet')).toBeVisible();
  });

  it('shows the first-read error with Retry, never an empty list', async () => {
    serveLab({ remotes: [] });
    let answer = 500;
    server.use(
      http.get(`*${API}/remotes/file/file/`, () =>
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
      await screen.findByText('Remotes could not be displayed.'),
    ).toBeVisible();
    expect(screen.queryByText('No remotes yet')).toBeNull();

    answer = 200;
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Retry' }));
    });
    expect(await screen.findByText('No remotes yet')).toBeVisible();
  });

  it('shows the insufficient permissions page with the reason when the list read is refused', async () => {
    serveLab({ remotes: [] });
    server.use(
      http.get(`*${API}/remotes/file/file/`, () =>
        HttpResponse.json(
          { detail: 'You do not have permission to perform this action.' },
          { status: 403 },
        ),
      ),
    );

    renderList();

    expect(
      await screen.findByText(
        'You do not have permission to perform this action.',
      ),
    ).toBeVisible();
    expect(screen.queryByText('No remotes yet')).toBeNull();
  });
});

describe(
  'Integration: the actions of the remote list',
  { tags: ['integration'] },
  () => {
    const ADD = 'file.add_fileremote';
    const CHANGE = 'file.change_fileremote';

    const holding = (...permissions: string[]) =>
      serveAccount({ isStaff: false, own: [permissions] });

    it('shows Add remote only to a user who holds the add permission, and leads to the create address', async () => {
      holding(ADD, CHANGE);
      serveLab({ remotes: named(2) });

      const { user } = renderList();
      await tableOf();

      await user.click(screen.getByRole('button', { name: 'Add remote' }));
      expect(screen.getByTestId('location').textContent).toBe(
        '/file/remote/new/',
      );
    });

    it('shows no Add remote to a user who does not hold the add permission', async () => {
      holding(CHANGE);
      serveLab({ remotes: named(2) });

      renderList();
      await tableOf();

      expect(screen.queryByRole('button', { name: 'Add remote' })).toBeNull();
    });

    it('shows no remotes yet with the add button for a user who may add one', async () => {
      holding(ADD);
      serveLab({ remotes: [] });

      renderList();

      expect(await screen.findByText('No remotes yet')).toBeVisible();
      expect(screen.getByRole('button', { name: 'Add remote' })).toBeVisible();
    });

    it('shows no remotes yet without an add button for a user who may not add one', async () => {
      holding(CHANGE);
      serveLab({ remotes: [] });

      renderList();

      expect(await screen.findByText('No remotes yet')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Add remote' })).toBeNull();
    });

    it('shows the filtered empty state with Clear all filters when a filter matches nothing', async () => {
      serveLab({ remotes: named(3) });

      const { user } = renderList(
        '/file/remotes?name__icontains=nothing-like-it',
      );

      expect(await screen.findByText('No results found')).toBeVisible();
      expect(screen.queryByText('No remotes yet')).toBeNull();
      const empty = screen
        .getByText('No results found')
        .closest('.pf-v6-c-empty-state') as HTMLElement;
      await user.click(
        within(empty).getByRole('button', { name: 'Clear all filters' }),
      );
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe(
          '/file/remotes',
        ),
      );
    });
  },
);

// What the shell shows of the tasks that ended, as the application root says it.
function Announcements() {
  const { alerts, dismiss } = useWatchedAnnouncements();

  return <AlertList alerts={alerts} closeAlert={dismiss} />;
}

describe(
  'Integration: the delete from a row of the remote list',
  { tags: ['integration'] },
  () => {
    const TASK_HREF = `${API}/tasks/5f1c3a0e-7d2b-4c1e-9a55-0c9d2e3f4a5b/`;

    it('sends one delete, says the removal started, and reads the list again when the task has ended', async () => {
      const held = named(2) as IRemote[];
      const lab = serveLab({ remotes: held });
      const deletes: string[] = [];
      server.use(
        http.delete(`*${API}/remotes/file/file/:id/`, ({ request }) => {
          const path = new URL(request.url).pathname;
          deletes.push(path);
          const at = held.findIndex(({ pulp_href }) => pulp_href === path);
          if (at >= 0) {
            held.splice(at, 1);
          }
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        }),
        http.get(`*${API}/tasks/:id/`, () =>
          HttpResponse.json({
            ...task({ pulp_href: TASK_HREF }),
            name: 'delete',
          }),
        ),
      );

      const { user } = renderWithProviders(
        <AppContextProvider>
          <WatchedTasksProvider>
            <PermissionsKnown>
              <Announcements />
              <Routed />
            </PermissionsKnown>
          </WatchedTasksProvider>
        </AppContextProvider>,
        { route: '/file/remotes', signedIn: true },
      );
      await tableOf();
      const [gone, kept] = held.slice() as IRemote[];

      await user.click(
        within(rowOf((gone as IRemote).name)).getByRole('button', {
          name: /actions|kebab/i,
        }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText((gone as IRemote).name)).toBeVisible();
      await user.click(
        await within(dialog).findByText('No repository uses this remote.'),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(deletes).toEqual([(gone as IRemote).pulp_href]);
      expect(
        await screen.findByText(
          `Removal started for remote ${(gone as IRemote).name}`,
        ),
      ).toBeVisible();
      // the end of the task is announced and the list is read again without it
      expect(
        await screen.findByText(
          `Removal of remote ${(gone as IRemote).name} finished.`,
        ),
      ).toBeVisible();
      await waitFor(() =>
        expect(
          screen.queryByRole('link', { name: (gone as IRemote).name }),
        ).toBeNull(),
      );
      expect(
        screen.getByRole('link', { name: (kept as IRemote).name }),
      ).toBeVisible();
      expect(lab.remotes.queries.length).toBeGreaterThan(1);
      expect(deletes).toHaveLength(1);
    });
  },
);
