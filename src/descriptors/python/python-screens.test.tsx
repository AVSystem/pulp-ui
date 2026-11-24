import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PLUGIN_MANIFESTS, type PluginManifest } from 'src/framework/manifest';
import { frameworkRoutes } from 'src/framework/routes';
import { SyncDialog } from 'src/framework/sync/sync-dialog';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  inSetOf,
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  projectedBy,
  pythonDistribution,
  role,
  roleAssignment,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { openSnippets } from 'src/test-utils/snippets';
import { serveSyncLab } from 'src/test-utils/sync-lab';
import pythonDescriptor from './descriptor';

// The python screens as a user meets them: the plugin is routed from the
// manifest, every list and form is drawn by the generic code from the python
// descriptor, and a server answers only the fields a request asks for.

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000ee/`;
const REMOTE_PATH = `${API}/remotes/python/python/`;
const REPOSITORY_PATH = `${API}/repositories/python/python/`;
const REMOTE = `${REMOTE_PATH}00000000-0000-4000-8000-000000000999/`;

const PYTHON: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'python',
  ) as PluginManifest),
  onFramework: true,
};

let permissions: { stop: () => void };
let posted: Record<string, unknown>[];
let patched: Record<string, unknown>[];
let syncs: { path: string; body: Record<string, unknown> }[];

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
  posted = [];
  patched = [];
  syncs = [];
});

afterEach(() => {
  permissions.stop();
});

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
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

type Remote = ReturnType<typeof pluginRemote>;
type Repository = ReturnType<typeof pluginRepository>;

// Every list the python screens read, and the writes of a remote and a
// repository. A python plugin has no publication endpoint, so none is served:
// a screen that asked for one would fail the test.
function serveLab({
  repositories = [],
  remotes = [],
  distributions = [],
}: {
  repositories?: Repository[];
  remotes?: Remote[];
  distributions?: ReturnType<typeof pythonDistribution>[];
} = {}) {
  const lab = {
    repositories: pluginListHandler('python', 'repository', repositories, {
      pageSize: 1000,
    }),
    remotes: pluginListHandler('python', 'remote', remotes, {
      pageSize: 1000,
    }),
  };
  server.use(
    lab.repositories.handler,
    lab.remotes.handler,
    distributionListHandler('python', distributions).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/remotes/`, remotes, {
      pageSize: 1000,
      matching: (row, query) => {
        const hrefs = inSetOf(query, 'pulp_href__in');
        return hrefs === null || hrefs.includes(row.pulp_href);
      },
      projected: projectedBy,
    }).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    http.post(REMOTE_PATH, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      return HttpResponse.json(
        pluginRemote('python', {
          name: String(body.name),
          url: String(body.url),
        }),
        { status: 201 },
      );
    }),
    http.patch(`*${REMOTE_PATH}:id/`, async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.patch(`*${REPOSITORY_PATH}:id/`, async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.post(REPOSITORY_PATH, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push(body);
      return HttpResponse.json(
        pluginRepository('python', { name: String(body.name) }),
        { status: 201 },
      );
    }),
    http.get(`*${API}/status/`, () =>
      HttpResponse.json({
        versions: [
          { component: 'core', version: '3.0.0' },
          { component: 'python', version: '3.0.0' },
        ],
        content_settings: {
          content_origin: 'https://pulp.example',
          content_path_prefix: '/pulp/content/',
        },
      }),
    ),
  );
  return lab;
}

const pypi = (overrides: Partial<Remote> = {}) =>
  pluginRemote('python', {
    name: 'pypi',
    url: 'https://pypi.example/simple/',
    policy: 'on_demand',
    includes: [],
    excludes: [],
    prereleases: false,
    package_types: [],
    keep_latest_packages: 0,
    exclude_platforms: [],
    provenance: false,
    vulnerabilities: false,
    ...overrides,
  });

const simple = (overrides: Partial<Repository> = {}) =>
  pluginRepository('python', {
    name: 'simple',
    allow_package_substitution: true,
    error_on_reject: true,
    ...overrides,
  });

const save = () => screen.getByRole('button', { name: /^Save/ });
const nameField = () => screen.findByRole('textbox', { name: /^Name/ });
const urlField = () => screen.getByRole('textbox', { name: /^URL/ });
const includesField = () => screen.getByRole('textbox', { name: /^Includes/ });
const excludesField = () => screen.getByRole('textbox', { name: /^Excludes/ });

// The Details rows as label -> the element holding the value.
async function detailRows(first: string) {
  const list = (await screen.findByText(first)).closest('dl') as HTMLElement;
  const rows = new Map<string, HTMLElement>();
  for (const group of Array.from(list.querySelectorAll(':scope > div'))) {
    rows.set(
      group.querySelector('dt')?.textContent as string,
      group.querySelector('dd') as HTMLElement,
    );
  }
  return rows;
}

describe(
  'Integration: the python remote screens built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('creates a remote with the on demand policy, the old defaults of the python fields, and no list or set the user left empty', async () => {
      serveLab();
      const { user } = render('/python/remote/new');

      await user.type(await nameField(), 'pypi');
      await user.type(urlField(), 'https://pypi.example/simple');
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toStrictEqual({
        name: 'pypi',
        url: 'https://pypi.example/simple/',
        policy: 'on_demand',
        tls_validation: true,
        prereleases: false,
        keep_latest_packages: 0,
        provenance: false,
        vulnerabilities: false,
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/python\/remotes\/pypi\/?$/,
        ),
      );
    });

    it('sends one specifier for each line of the includes and excludes, the chosen package types and platforms and the scan switch', async () => {
      serveLab();
      const { user } = render('/python/remote/new');

      await user.type(await nameField(), 'pypi');
      await user.type(urlField(), 'https://pypi.example/simple/');
      await user.type(includesField(), 'django>=4.2{Enter}  requests {Enter}');
      await user.type(excludesField(), 'django<4');
      await user.click(screen.getByRole('checkbox', { name: 'sdist' }));
      await user.click(screen.getByRole('checkbox', { name: 'bdist_wheel' }));
      await user.click(screen.getByRole('checkbox', { name: 'windows' }));
      await user.click(
        screen.getByRole('checkbox', { name: /Include pre-release versions/ }),
      );
      await user.type(
        screen.getByRole('spinbutton', {
          name: /Latest versions kept per package/,
        }),
        '2',
      );
      await user.click(
        screen.getByRole('checkbox', { name: /Scan new repository versions/ }),
      );
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        includes: ['django>=4.2', 'requests'],
        excludes: ['django<4'],
        package_types: ['sdist', 'bdist_wheel'],
        exclude_platforms: ['windows'],
        prereleases: true,
        keep_latest_packages: 2,
        provenance: false,
        vulnerabilities: true,
      });
    });

    it('opens an existing remote with its lists one to a line and its sets ticked, and sends one PATCH of the field that changed', async () => {
      serveLab({
        remotes: [
          pypi({
            includes: ['django>=4.2', 'requests'],
            package_types: ['sdist'],
            exclude_platforms: ['macos'],
            vulnerabilities: true,
          }),
        ],
      });
      const { user } = render('/python/remotes/pypi/edit');

      await screen.findByDisplayValue('pypi');
      expect(includesField()).toHaveValue('django>=4.2\nrequests');
      expect(screen.getByRole('checkbox', { name: 'sdist' })).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: 'bdist_wheel' }),
      ).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'macos' })).toBeChecked();
      expect(
        screen.getByRole('checkbox', { name: /Scan new repository versions/ }),
      ).toBeChecked();

      await user.type(excludesField(), 'django<4');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ excludes: ['django<4'] });
    });

    it('sends the emptied includes as an empty list and no request when nothing changed', async () => {
      serveLab({ remotes: [pypi({ includes: ['django'] })] });
      const { user } = render('/python/remotes/pypi/edit');

      await screen.findByDisplayValue('pypi');
      await user.clear(includesField());
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ includes: [] });
    });

    it('lists the remotes with their policy and shows the python rows of a remote', async () => {
      serveLab({
        remotes: [
          pypi({ name: 'main-mirror', policy: 'immediate' }),
          pypi({ name: 'lazy', policy: 'streamed' }),
        ],
      });
      render('/python/remotes');

      const table = await screen.findByRole('grid', { name: 'Remotes' });
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim());
      for (const title of ['Remote name', 'URL', 'Download policy']) {
        expect(headers).toContain(title);
      }
      const row = (name: string) =>
        screen.getByRole('link', { name }).closest('tr') as HTMLElement;
      expect(row('main-mirror')).toHaveTextContent('Immediate');
      expect(row('lazy')).toHaveTextContent('Streamed');
      expect(
        within(row('main-mirror')).getByRole('link', { name: 'main-mirror' }),
      ).toHaveAttribute('href', '/python/remotes/main-mirror/');
    });

    it('shows what the remote syncs among its Details, the scan included', async () => {
      serveLab({
        remotes: [
          pypi({
            includes: ['django>=4.2'],
            prereleases: true,
            package_types: ['sdist'],
            keep_latest_packages: 3,
            exclude_platforms: ['windows'],
            provenance: true,
            vulnerabilities: true,
          }),
        ],
      });
      render('/python/remotes/pypi/');

      const rows = await detailRows('Remote name');
      expect(rows.get('Download policy')).toHaveTextContent('On demand');
      expect(rows.get('Includes')).toHaveTextContent('django>=4.2');
      expect(rows.get('Excludes')).toHaveTextContent('None');
      expect(rows.get('Pre-releases')).toHaveTextContent('Included');
      expect(rows.get('Package types')).toHaveTextContent('sdist');
      expect(rows.get('Latest versions kept per package')).toHaveTextContent(
        '3',
      );
      expect(rows.get('Excluded platforms')).toHaveTextContent('windows');
      expect(rows.get('Provenance')).toHaveTextContent('Synced');
      expect(rows.get('Vulnerability scan')).toHaveTextContent('Enabled');
    });
  },
);

describe(
  'Integration: the python repository screens',
  { tags: ['integration'] },
  () => {
    it('shows the rows of every repository and the python rows in the order the old page had them', async () => {
      serveLab({
        repositories: [
          simple({
            retain_repo_versions: 5,
            allow_package_substitution: false,
          }),
        ],
      });
      render('/python/repositories/simple/');

      const rows = await detailRows('Repository name');
      expect(Array.from(rows.keys())).toEqual([
        'Repository name',
        'Description',
        'Retained version count',
        'Package substitution',
        'When packages are rejected',
        'Repository URL',
        'Labels',
        'Remote',
        'Last sync',
      ]);
      expect(rows.get('Retained version count')).toHaveTextContent('5');
      expect(rows.get('Package substitution')).toHaveTextContent('Not allowed');
      expect(rows.get('When packages are rejected')).toHaveTextContent(
        'Fail the whole version',
      );
    });

    it('lists the repositories with a Sync, Edit, Delete menu where a remote is set and no Sync where it is not', async () => {
      const remote = pypi();
      serveLab({
        remotes: [remote],
        repositories: [
          simple({ name: 'synced', remote: remote.pulp_href }),
          simple({ name: 'alone' }),
        ],
      });
      const { user } = render('/python/repositories');

      await screen.findByRole('link', { name: 'synced' });
      const menu = async (name: string) => {
        const row = screen
          .getByRole('link', { name })
          .closest('tr') as HTMLElement;
        await user.click(within(row).getByRole('button', { name: /actions/i }));
        return screen.getAllByRole('menuitem').map((item) => item.textContent);
      };

      expect(await menu('synced')).toEqual(['Sync', 'Edit', 'Delete']);
      await user.keyboard('{Escape}');
      expect(await menu('alone')).toEqual(['Edit', 'Delete']);
    });

    it('shows the pip command of a distribution, quoted, and asks for no publication', async () => {
      const repository = simple();
      const seen: string[] = [];
      server.events.on('request:start', ({ request }) => {
        seen.push(new URL(request.url).pathname);
      });
      serveLab({
        repositories: [repository],
        distributions: [
          pythonDistribution({
            name: 'simple-dist',
            base_path: 'simple',
            base_url: 'https://pulp.example/pulp/content/simple/',
            repository: repository.pulp_href,
          }),
        ],
      });
      const { user } = render('/python/repositories/simple/distributions');
      await openSnippets(user, 'simple-dist', 'Install with pip');

      const line = await screen.findByText(/pip install/);
      expect(line.textContent).toBe(
        "pip install --index-url 'https://pulp.example/pulp/content/simple/simple/' <package>",
      );
      expect(seen.filter((path) => path.includes('/publications/'))).toEqual(
        [],
      );
      server.events.removeAllListeners();
    });
  },
);

describe(
  'Integration: the python sync dialog',
  { tags: ['integration'] },
  () => {
    const repository = () =>
      pluginRepository('python', { name: 'simple', remote: REMOTE });

    function renderDialog(row: Repository) {
      serveSyncLab({ repository: row });
      server.use(
        http.post(
          `*${API}/repositories/python/python/:id/sync/`,
          async ({ request }) => {
            syncs.push({
              path: new URL(request.url).pathname,
              body: (await request.json()) as Record<string, unknown>,
            });
            return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
          },
        ),
      );
      return renderWithProviders(
        <SyncDialog
          descriptor={pythonDescriptor}
          repository={row}
          onClose={() => undefined}
        />,
      );
    }

    it('offers the mirror switch off and no optimize option, and sends { remote, mirror: false } unless the user turns the mirror on', async () => {
      const row = repository();
      const { user } = renderDialog(row);

      expect(
        screen.getByRole('switch', {
          name: /Content not present in remote repository/,
        }),
      ).not.toBeChecked();
      expect(
        screen.queryByRole('switch', {
          name: /Only perform the sync if changes/,
        }),
      ).toBeNull();
      await user.click(screen.getByRole('button', { name: /^Sync/ }));

      await waitFor(() => expect(syncs).toHaveLength(1));
      expect(syncs[0]?.body).toStrictEqual({
        remote: row.remote,
        mirror: false,
      });
    });

    it('sends the mirror the user turned on', async () => {
      const row = repository();
      const { user } = renderDialog(row);

      await user.click(
        screen.getByRole('switch', {
          name: /Content not present in remote repository/,
        }),
      );
      await user.click(screen.getByRole('button', { name: /^Sync/ }));

      await waitFor(() => expect(syncs).toHaveLength(1));
      expect(syncs[0]?.body).toStrictEqual({
        remote: row.remote,
        mirror: true,
      });
    });
  },
);

// The actions of a python list follow the permissions the account holds, on
// every repository or through a role on one of them (the manifest says python
// roles are granted on a single repository).
describe(
  'Integration: who may act on python repositories',
  { tags: ['integration'] },
  () => {
    const CHANGE = 'python.change_pythonrepository';
    const DELETE = 'python.delete_pythonrepository';
    const SYNC = 'python.sync_pythonrepository';
    const OWNER = 'python.pythonrepository_owner';
    const stops: { stop: () => void }[] = [];

    afterEach(() => {
      for (const served of stops.splice(0)) {
        served.stop();
      }
    });

    const rowOf = (name: string) =>
      screen.getByRole('link', { name }).closest('tr') as HTMLElement;

    it('shows an account that may only view neither the add button nor a row action', async () => {
      stops.push(
        servePermissions({
          id: 7,
          isStaff: false,
          own: [['python.view_pythonrepository']],
        }),
      );
      serveLab({ repositories: [simple({ name: 'viewed' })] });
      render('/python/repositories');

      const table = await screen.findByRole('grid', { name: 'Repositories' });
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );

      expect(
        screen.queryByRole('button', { name: 'Add repository' }),
      ).toBeNull();
      expect(
        within(rowOf('viewed')).queryByRole('button', { name: /actions/i }),
      ).toBeNull();
    });

    it('offers the row actions the role allows for a repository the account holds a role on, and none for another', async () => {
      const owned = simple({ name: 'owned', remote: REMOTE });
      const foreign = simple({ name: 'foreign', remote: REMOTE });
      stops.push(servePermissions({ id: 7, isStaff: false, own: [[]] }));
      serveLab({ repositories: [owned, foreign] });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment(OWNER, owned.pulp_href)],
          {
            pageSize: 1000,
            matching: (row, query) =>
              query.get('content_object') !== 'null' ||
              row.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(
            page([role({ name: OWNER, permissions: [CHANGE, DELETE, SYNC] })]),
          ),
        ),
      );
      const { user } = render('/python/repositories');

      const table = await screen.findByRole('grid', { name: 'Repositories' });
      await waitFor(() =>
        expect(table).toHaveAttribute('data-columns-loaded', 'true'),
      );
      await user.click(
        await within(rowOf('owned')).findByRole('button', { name: /actions/i }),
      );

      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent),
      ).toEqual(['Sync', 'Edit', 'Delete']);
      expect(
        within(rowOf('foreign')).queryByRole('button', { name: /actions/i }),
      ).toBeNull();
    });
  },
);

describe(
  'Integration: the python repository forms',
  { tags: ['integration'] },
  () => {
    const substitution = () =>
      screen.getByRole('checkbox', {
        name: /Allow same-filename packages with different contents/,
      });
    const rejection = () =>
      screen.getByRole('checkbox', {
        name: /Fail the whole version if any package is rejected/,
      });

    it('offers both package rules ticked and creates a repository that sends them, with no autopublish', async () => {
      serveLab();
      const { user } = render('/python/repository/new');

      await user.type(await nameField(), 'simple');
      expect(substitution()).toBeChecked();
      expect(rejection()).toBeChecked();
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        name: 'simple',
        allow_package_substitution: true,
        error_on_reject: true,
      });
      expect(posted[0]).not.toHaveProperty('autopublish');
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/python\/repositories\/simple\/?$/,
        ),
      );
    });

    it('sends the rules the user unticked', async () => {
      serveLab();
      const { user } = render('/python/repository/new');

      await user.type(await nameField(), 'simple');
      await user.click(substitution());
      await user.click(rejection());
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        allow_package_substitution: false,
        error_on_reject: false,
      });
    });

    it('edits a repository with one PATCH of the rule that was changed and offers no distribution', async () => {
      serveLab({ repositories: [simple({ error_on_reject: true })] });
      const { user } = render('/python/repositories/simple/edit');

      await screen.findByDisplayValue('simple');
      expect(rejection()).toBeChecked();
      expect(
        screen.queryByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeNull();

      await user.click(rejection());
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ error_on_reject: false });
    });

    it('shows a rule the server holds as off, unticked, and sends no request when nothing changed', async () => {
      serveLab({
        repositories: [simple({ allow_package_substitution: false })],
      });
      const { user } = render('/python/repositories/simple/edit');

      await screen.findByDisplayValue('simple');
      expect(substitution()).not.toBeChecked();
      await user.click(save());

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/python\/repositories\/simple\/?$/,
        ),
      );
      expect(patched).toEqual([]);
    });
  },
);
