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
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRemote,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  role,
  roleAssignment,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { openSnippets } from 'src/test-utils/snippets';
import { serveSyncLab } from 'src/test-utils/sync-lab';
import rpmDescriptor from './descriptor';

// The rpm screens as a user meets them: the plugin is routed from the manifest,
// every list and form is drawn by the generic code from the rpm descriptor, and
// a server answers only the fields a request asks for.

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000ee/`;
const REMOTE_PATH = `${API}/remotes/rpm/rpm/`;
const REPOSITORY_PATH = `${API}/repositories/rpm/rpm/`;
const REMOTE = `${REMOTE_PATH}00000000-0000-4000-8000-000000000999/`;

const RPM: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'rpm',
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

type Remote = ReturnType<typeof pluginRemote>;
type Repository = ReturnType<typeof pluginRepository>;

// Every list the rpm screens read, and the writes of a remote and a repository.
// `others` are remotes of another type, which the generic list of every
// plugin's remotes holds and the rpm list does not.
function serveLab({
  repositories = [],
  remotes = [],
  others = [],
  distributions = [],
  publications = [],
}: {
  repositories?: Repository[];
  remotes?: Remote[];
  others?: Remote[];
  distributions?: ReturnType<typeof pluginDistribution>[];
  publications?: ReturnType<typeof pluginPublication>[];
} = {}) {
  const lab = {
    repositories: pluginListHandler('rpm', 'repository', repositories, {
      pageSize: 1000,
    }),
    remotes: pluginListHandler('rpm', 'remote', remotes, { pageSize: 1000 }),
  };
  server.use(
    lab.repositories.handler,
    lab.remotes.handler,
    distributionListHandler('rpm', distributions).handler,
    publicationListHandler('rpm', publications).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/remotes/`, [...remotes, ...others], {
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
        pluginRemote('rpm', { name: String(body.name), url: String(body.url) }),
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
        pluginRepository('rpm', { name: String(body.name) }),
        { status: 201 },
      );
    }),
    http.post(`*${REPOSITORY_PATH}:id/sync/`, async ({ request }) => {
      syncs.push({
        path: new URL(request.url).pathname,
        body: (await request.json()) as Record<string, unknown>,
      });
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.get(`*${API}/status/`, () =>
      HttpResponse.json({
        versions: [
          { component: 'core', version: '3.0.0' },
          { component: 'rpm', version: '3.0.0' },
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

const upstream = (overrides: Partial<Remote> = {}) =>
  pluginRemote('rpm', {
    name: 'upstream',
    url: 'https://rpm.example/baseos/',
    policy: 'on_demand',
    ...overrides,
  });

const baseos = (overrides: Partial<Repository> = {}) =>
  pluginRepository('rpm', {
    name: 'baseos',
    autopublish: true,
    retain_package_versions: 0,
    ...overrides,
  });

const save = () => screen.getByRole('button', { name: /^Save/ });
const nameField = () => screen.findByRole('textbox', { name: /^Name/ });
const urlField = () => screen.getByRole('textbox', { name: /^URL/ });
const packageVersionsField = () =>
  screen.getByRole('spinbutton', { name: /Versions kept per package/ });

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
  'Integration: the rpm remote screens built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('creates a remote with the on demand policy unless the user picks another, and sends nothing for a field left empty', async () => {
      serveLab();
      const { user } = render('/rpm/remote/new');

      await user.type(await nameField(), 'upstream');
      await user.type(urlField(), 'https://rpm.example/baseos');
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toStrictEqual({
        name: 'upstream',
        url: 'https://rpm.example/baseos/',
        policy: 'on_demand',
        tls_validation: true,
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/rpm\/remotes\/upstream\/?$/,
        ),
      );
    });

    it('opens an existing remote with its values and sends one PATCH of the changed field', async () => {
      serveLab({ remotes: [upstream()] });
      const { user } = render('/rpm/remotes/upstream/edit');

      await screen.findByDisplayValue('upstream');
      expect(urlField()).toHaveValue('https://rpm.example/baseos/');

      await user.clear(urlField());
      await user.type(urlField(), 'https://mirror.example/baseos/');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({
        url: 'https://mirror.example/baseos/',
      });
    });

    it('lists the remotes with their policy and shows the rows of a remote', async () => {
      serveLab({
        remotes: [
          upstream({ name: 'main-mirror', policy: 'immediate' }),
          upstream({ name: 'lazy', policy: 'streamed' }),
        ],
      });
      render('/rpm/remotes');

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
      ).toHaveAttribute('href', '/rpm/remotes/main-mirror/');
    });

    it('shows the download policy of a remote among its Details', async () => {
      serveLab({ remotes: [upstream({ policy: 'on_demand' })] });
      render('/rpm/remotes/upstream/');

      const rows = await detailRows('Remote name');
      expect(rows.get('Download policy')).toHaveTextContent('On demand');
      expect(rows.get('URL')).toHaveTextContent('https://rpm.example/baseos/');
    });
  },
);

describe(
  'Integration: the rpm repository screens',
  { tags: ['integration'] },
  () => {
    it('shows the rows of every repository and the rpm rows in the order the old page had them', async () => {
      serveLab({
        repositories: [
          baseos({ retain_repo_versions: 5, retain_package_versions: 2 }),
        ],
      });
      render('/rpm/repositories/baseos/');

      const rows = await detailRows('Repository name');
      expect(Array.from(rows.keys())).toEqual([
        'Repository name',
        'Description',
        'Retained version count',
        'Autopublish',
        'Retained package versions',
        'Repository URL',
        'Labels',
        'Remote',
        'Last sync',
      ]);
      expect(rows.get('Retained version count')).toHaveTextContent('5');
      expect(rows.get('Autopublish')).toHaveTextContent('Enabled');
      expect(rows.get('Retained package versions')).toHaveTextContent('2');
    });

    it('says All for the retained package versions when the server holds 0', async () => {
      serveLab({ repositories: [baseos({ retain_package_versions: 0 })] });
      render('/rpm/repositories/baseos/');

      const rows = await detailRows('Repository name');
      expect(rows.get('Retained package versions')).toHaveTextContent('All');
    });

    it('names the ULN remote of a repository as text and links the remote of the plugin', async () => {
      const uln = pluginRemote('rpm', { name: 'uln-channel' });
      uln.pulp_href = uln.pulp_href.replace(
        'remotes/rpm/rpm',
        'remotes/rpm/uln',
      );
      const plain = upstream();
      serveLab({
        repositories: [
          baseos({ name: 'from-uln', remote: uln.pulp_href }),
          baseos({ name: 'from-rpm', remote: plain.pulp_href }),
        ],
        remotes: [plain],
        others: [uln],
      });
      render('/rpm/repositories/from-uln/');

      const rows = await detailRows('Repository name');
      await waitFor(() =>
        expect(rows.get('Remote')).toHaveTextContent('uln-channel'),
      );
      expect(
        within(rows.get('Remote') as HTMLElement).queryByRole('link'),
      ).toBe(null);
    });

    it('links the remote of the plugin to its page', async () => {
      const plain = upstream();
      serveLab({
        repositories: [baseos({ remote: plain.pulp_href })],
        remotes: [plain],
      });
      render('/rpm/repositories/baseos/');

      const rows = await detailRows('Repository name');
      const link = await within(rows.get('Remote') as HTMLElement).findByRole(
        'link',
        { name: 'upstream' },
      );
      expect(link).toHaveAttribute('href', '/rpm/remotes/upstream/');
    });

    it('lists the repositories with a Sync, Edit, Delete menu where a remote is set and no Sync where it is not', async () => {
      const remote = upstream();
      serveLab({
        remotes: [remote],
        repositories: [
          baseos({ name: 'synced', remote: remote.pulp_href }),
          baseos({ name: 'alone' }),
        ],
      });
      const { user } = render('/rpm/repositories');

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

    it('shows the command line of a distribution, quoted', async () => {
      const repository = baseos();
      serveLab({
        repositories: [repository],
        distributions: [
          pluginDistribution('rpm', {
            name: 'baseos-dist',
            base_path: 'baseos',
            base_url: 'https://pulp.example/pulp/content/baseos/',
            repository: repository.pulp_href,
          }),
        ],
        publications: [
          pluginPublication('rpm', { repository: repository.pulp_href }),
        ],
      });
      const { user } = render('/rpm/repositories/baseos/distributions');
      await openSnippets(user, 'baseos-dist', 'CLI configuration');

      const line = await screen.findByText(/pulp rpm remote create/);
      expect(line.textContent).toBe(
        "pulp rpm remote create --name 'baseos' --url 'https://pulp.example/pulp/content/baseos/'",
      );
    });
  },
);

describe('Integration: the rpm sync dialog', { tags: ['integration'] }, () => {
  const repository = () =>
    pluginRepository('rpm', {
      name: 'baseos',
      autopublish: true,
      remote: REMOTE,
    });

  function renderDialog(row: Repository) {
    serveSyncLab({ repository: row });
    server.use(
      http.post(
        `*${API}/repositories/rpm/rpm/:id/sync/`,
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
        descriptor={rpmDescriptor}
        repository={row}
        onClose={() => undefined}
      />,
    );
  }

  it('asks for a sync policy, starts on additive even for a repository that publishes by itself, optimize on, and sends them with the remote', async () => {
    const row = repository();
    const { user } = renderDialog(row);

    const policy = screen.getByRole('combobox', { name: /Sync policy/ });
    expect(policy).toHaveValue('additive');
    expect(policy).toBeEnabled();
    expect(
      screen.queryByRole('switch', {
        name: /Content not present in remote repository/,
      }),
    ).toBeNull();
    expect(
      screen.getByRole('switch', { name: /Only perform the sync if changes/ }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: /^Sync/ }));

    await waitFor(() => expect(syncs).toHaveLength(1));
    expect(syncs[0]?.body).toStrictEqual({
      remote: row.remote,
      sync_policy: 'additive',
      optimize: true,
    });
  });

  it('sends the policy the user chose and the optimize choice', async () => {
    const row = repository();
    const { user } = renderDialog(row);

    await user.selectOptions(
      screen.getByRole('combobox', { name: /Sync policy/ }),
      'mirror_complete',
    );
    await user.click(
      screen.getByRole('switch', { name: /Only perform the sync if changes/ }),
    );
    await user.click(screen.getByRole('button', { name: /^Sync/ }));

    await waitFor(() => expect(syncs).toHaveLength(1));
    expect(syncs[0]?.body).toStrictEqual({
      remote: row.remote,
      sync_policy: 'mirror_complete',
      optimize: false,
    });
  });

  it('names the three policies', () => {
    renderDialog(repository());

    const policy = screen.getByRole('combobox', { name: /Sync policy/ });
    expect(
      within(policy)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual([
      'Additive: only add new content',
      'Mirror content only',
      'Mirror complete (exact copy incl. metadata)',
    ]);
  });
});

describe(
  'Integration: syncing selected rpm repositories',
  { tags: ['integration'] },
  () => {
    it('starts one sync for every selected repository with a remote, with the policy chosen once for all, and skips the one without a remote', async () => {
      const repositories = [
        baseos({ name: 'repo-0001', remote: REMOTE }),
        baseos({ name: 'repo-0002', remote: null }),
        baseos({ name: 'repo-0003', remote: REMOTE }),
      ];
      serveLab({ repositories });
      const { user } = render('/rpm/repositories');

      await screen.findByRole('grid', { name: 'Repositories' });
      await user.click(
        await screen.findByRole('checkbox', {
          name: 'Select all repositories on this page',
        }),
      );
      await user.click(
        await screen.findByRole('button', { name: 'Bulk actions' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Sync' }));
      const dialog = await screen.findByRole('dialog');

      const policy = within(dialog).getByRole('combobox', {
        name: /Sync policy/,
      });
      expect(policy).toHaveValue('additive');
      expect(syncs).toStrictEqual([]);
      await user.selectOptions(policy, 'mirror_content_only');
      await user.click(within(dialog).getByRole('button', { name: 'Sync' }));
      await waitFor(
        () =>
          expect(
            within(dialog)
              .getAllByRole('button', { name: /^Close/ })
              .at(-1),
          ).toBeEnabled(),
        { timeout: 10_000 },
      );

      expect(syncs).toHaveLength(2);
      for (const { body } of syncs) {
        expect(body).toStrictEqual({
          remote: REMOTE,
          sync_policy: 'mirror_content_only',
          optimize: true,
        });
      }
      expect(syncs.map(({ path }) => path).sort()).toEqual(
        [repositories[0], repositories[2]]
          .map((row) => `${(row as Repository).pulp_href}sync/`)
          .sort(),
      );
    });
  },
);

// The actions of an rpm list follow the permissions the account holds, on
// every repository or through a role on one of them.
describe(
  'Integration: who may act on rpm repositories',
  { tags: ['integration'] },
  () => {
    const CHANGE = 'rpm.change_rpmrepository';
    const DELETE = 'rpm.delete_rpmrepository';
    const SYNC = 'rpm.sync_rpmrepository';
    const OWNER = 'rpm.rpmrepository_owner';
    const stops: { stop: () => void }[] = [];

    afterEach(() => {
      for (const served of stops.splice(0)) {
        served.stop();
      }
    });

    function serveAccount(held: string[]) {
      stops.push(servePermissions({ id: 7, isStaff: false, own: [held] }));
    }

    const rowOf = (name: string) =>
      screen.getByRole('link', { name }).closest('tr') as HTMLElement;

    it('offers the row actions to an account that holds the permissions on every repository', async () => {
      serveAccount([CHANGE, DELETE, SYNC]);
      const remote = upstream();
      serveLab({
        remotes: [remote],
        repositories: [baseos({ name: 'mirror', remote: remote.pulp_href })],
      });
      const { user } = render('/rpm/repositories');

      await screen.findByRole('link', { name: 'mirror' });
      await user.click(
        within(rowOf('mirror')).getByRole('button', { name: /actions/i }),
      );

      expect(
        screen.getAllByRole('menuitem').map((item) => item.textContent),
      ).toEqual(['Sync', 'Edit', 'Delete']);
    });

    it('shows an account that may only view neither the add button nor a row action', async () => {
      serveAccount(['rpm.view_rpmrepository']);
      serveLab({ repositories: [baseos({ name: 'viewed' })] });
      render('/rpm/repositories');

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
      const owned = baseos({ name: 'owned', remote: REMOTE });
      const foreign = baseos({ name: 'foreign', remote: REMOTE });
      serveAccount([]);
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
      const { user } = render('/rpm/repositories');

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
  'Integration: the rpm repository forms',
  { tags: ['integration'] },
  () => {
    it('offers autopublish unticked and the versions kept per package blank, and creates a repository with 0 for the blank field', async () => {
      serveLab();
      const { user } = render('/rpm/repository/new');

      await user.type(await nameField(), 'baseos');
      expect(
        screen.getByRole('checkbox', {
          name: /Publish new versions automatically/,
        }),
      ).not.toBeChecked();
      expect(packageVersionsField()).toHaveValue(null);
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        name: 'baseos',
        autopublish: false,
        retain_package_versions: 0,
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/rpm\/repositories\/baseos\/?$/,
        ),
      );
    });

    it('sends the number of package versions typed, and the autopublish choice the user made', async () => {
      serveLab();
      const { user } = render('/rpm/repository/new');

      await user.type(await nameField(), 'baseos');
      await user.type(packageVersionsField(), '3');
      await user.click(
        screen.getByRole('checkbox', {
          name: /Publish new versions automatically/,
        }),
      );
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        retain_package_versions: 3,
        autopublish: true,
      });
    });

    it('edits a repository with one PATCH of the field that was changed and offers no distribution', async () => {
      serveLab({ repositories: [baseos({ autopublish: true })] });
      const { user } = render('/rpm/repositories/baseos/edit');

      const autopublish = await screen.findByRole('checkbox', {
        name: /Publish new versions automatically/,
      });
      expect(autopublish).toBeChecked();
      expect(
        screen.queryByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeNull();

      await user.click(autopublish);
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ autopublish: false });
    });

    it('sends 0 when the package versions field was emptied, because the server has no null for it', async () => {
      serveLab({ repositories: [baseos({ retain_package_versions: 3 })] });
      const { user } = render('/rpm/repositories/baseos/edit');

      await screen.findByDisplayValue('baseos');
      expect(packageVersionsField()).toHaveValue(3);
      await user.clear(packageVersionsField());
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ retain_package_versions: 0 });
    });

    it('shows the field blank when the server holds 0 and sends no request when nothing changed', async () => {
      serveLab({ repositories: [baseos({ retain_package_versions: 0 })] });
      const { user } = render('/rpm/repositories/baseos/edit');

      await screen.findByDisplayValue('baseos');
      expect(packageVersionsField()).toHaveValue(null);
      await user.click(save());

      expect(await screen.findByText(/Nothing changed/)).toBeInTheDocument();
      expect(patched).toEqual([]);
    });
  },
);
