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
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRemote,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { serveSyncLab } from 'src/test-utils/sync-lab';
import debDescriptor from './descriptor';

// The deb screens as a user meets them: the plugin is routed from the manifest,
// every list and form is drawn by the generic code from the deb descriptor, and
// a server answers only the fields a request asks for.

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000dd/`;
const REMOTE_PATH = `${API}/remotes/deb/apt/`;

const DEB: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'deb',
  ) as PluginManifest),
  onFramework: true,
};

let permissions: { stop: () => void };
let posted: Record<string, unknown>[];
let patched: Record<string, unknown>[];

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
  posted = [];
  patched = [];
});

afterEach(() => {
  permissions.stop();
});

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
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

type Remote = ReturnType<typeof pluginRemote>;
type Repository = ReturnType<typeof pluginRepository>;

// Every list the deb screens read, and the writes of a remote.
function serveLab({
  repositories = [],
  remotes = [],
  distributions = [],
  publications = [],
}: {
  repositories?: Repository[];
  remotes?: Remote[];
  distributions?: ReturnType<typeof pluginDistribution>[];
  publications?: ReturnType<typeof pluginPublication>[];
} = {}) {
  const lab = {
    repositories: pluginListHandler('deb', 'repository', repositories, {
      pageSize: 1000,
    }),
    remotes: pluginListHandler('deb', 'remote', remotes, { pageSize: 1000 }),
  };
  server.use(
    lab.repositories.handler,
    lab.remotes.handler,
    distributionListHandler('deb', distributions).handler,
    publicationListHandler('deb', publications).handler,
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
        pluginRemote('deb', {
          name: String(body.name),
          url: String(body.url),
          distributions: String(body.distributions),
        }),
        { status: 201 },
      );
    }),
    http.patch(`*${REMOTE_PATH}:id/`, async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
  );
  return lab;
}

const upstream = (overrides: Partial<Remote> = {}) =>
  pluginRemote('deb', {
    name: 'upstream',
    url: 'https://deb.example/debian/',
    policy: 'on_demand',
    distributions: 'bookworm',
    components: null,
    architectures: null,
    gpgkey: null,
    sync_sources: false,
    sync_udebs: false,
    sync_installer: false,
    ...overrides,
  });

const save = () => screen.getByRole('button', { name: 'Save' });
const nameField = () => screen.findByRole('textbox', { name: 'Name' });
const urlField = () => screen.getByRole('textbox', { name: /^URL/ });
const distributionsField = () =>
  screen.getByRole('textbox', { name: /^Distributions/ });

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
  'Integration: the deb remote form built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('keeps Save off until the name, the URL and the distributions are given, and marks the distributions as required', async () => {
      serveLab();
      const { user } = render('/deb/remote/new');

      await user.type(await nameField(), 'upstream');
      await user.type(urlField(), 'https://deb.example/debian/');
      expect(save()).toBeDisabled();
      expect(distributionsField()).toBeRequired();

      await user.type(distributionsField(), 'bookworm');
      expect(save()).toBeEnabled();

      await user.clear(distributionsField());
      await user.type(distributionsField(), '   ');
      expect(save()).toBeDisabled();
    });

    it('sends the apt fields as typed with the default policy and nothing for a field left empty', async () => {
      serveLab();
      const { user } = render('/deb/remote/new');

      await user.type(await nameField(), 'upstream');
      await user.type(urlField(), 'https://deb.example/debian');
      await user.type(distributionsField(), 'bookworm bookworm-updates');
      await user.type(
        screen.getByRole('textbox', { name: /^Components/ }),
        'main contrib',
      );
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toStrictEqual({
        name: 'upstream',
        url: 'https://deb.example/debian/',
        policy: 'on_demand',
        tls_validation: true,
        distributions: 'bookworm bookworm-updates',
        components: 'main contrib',
        sync_sources: false,
        sync_udebs: false,
        sync_installer: false,
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/deb\/remotes\/upstream\/?$/,
        ),
      );
    });

    it('takes the GPG key from an uploaded file and sends it with the sync choices that were ticked', async () => {
      serveLab();
      const { user } = render('/deb/remote/new');

      await user.type(await nameField(), 'upstream');
      await user.type(urlField(), 'https://deb.example/debian/');
      await user.type(distributionsField(), 'bookworm');
      const key =
        '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc\n-----END PGP PUBLIC KEY BLOCK-----';
      // the GPG key is the first file input: the advanced options are closed
      const uploads = document.querySelectorAll('input[type="file"]');
      await user.upload(
        uploads[0] as HTMLInputElement,
        new File([key], 'release.asc', { type: 'text/plain' }),
      );
      await waitFor(() =>
        expect(
          screen.getByLabelText(/^GPG key/, { selector: 'textarea' }),
        ).toHaveValue(key),
      );
      await user.click(
        screen.getByRole('checkbox', { name: /Source packages will be/ }),
      );
      await user.click(
        screen.getByRole('checkbox', { name: /Installer files will be/ }),
      );
      await user.click(save());

      await waitFor(() => expect(posted).toHaveLength(1));
      expect(posted[0]).toMatchObject({
        gpgkey: key,
        sync_sources: true,
        sync_udebs: false,
        sync_installer: true,
      });
    });

    it('opens an existing remote with its values, keeps Save off for emptied distributions and sends only a changed field', async () => {
      serveLab({
        remotes: [upstream({ components: 'main', architectures: 'amd64' })],
      });
      const { user } = render('/deb/remotes/upstream/edit');

      await screen.findByDisplayValue('upstream');
      expect(distributionsField()).toHaveValue('bookworm');
      expect(screen.getByRole('textbox', { name: /^Components/ })).toHaveValue(
        'main',
      );
      expect(
        screen.getByRole('textbox', { name: /^Architectures/ }),
      ).toHaveValue('amd64');

      await user.clear(distributionsField());
      expect(save()).toBeDisabled();

      await user.type(distributionsField(), 'trixie');
      await user.clear(screen.getByRole('textbox', { name: /^Components/ }));
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({
        distributions: 'trixie',
        components: null,
      });
    });
  },
);

describe(
  'Integration: the deb remote list and Details',
  { tags: ['integration'] },
  () => {
    it('lists the remotes with their distributions and shows --- for a remote without any', async () => {
      serveLab({
        remotes: [
          upstream({ name: 'main-mirror', distributions: 'bookworm trixie' }),
          upstream({ name: 'bare', distributions: '' }),
        ],
      });
      render('/deb/remotes');

      const table = await screen.findByRole('grid', { name: 'Remotes' });
      const headers = within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent);
      for (const title of ['Remote name', 'URL', 'Distributions']) {
        expect(headers.map((header) => header?.trim())).toContain(title);
      }
      const row = (name: string) =>
        screen.getByRole('link', { name }).closest('tr') as HTMLElement;
      expect(row('main-mirror')).toHaveTextContent('bookworm trixie');
      expect(row('bare')).toHaveTextContent('---');
      expect(
        within(row('main-mirror')).getByRole('link', { name: 'main-mirror' }),
      ).toHaveAttribute('href', '/deb/remotes/main-mirror/');
    });

    it('shows the apt rows of a remote, with the GPG key as a code block', async () => {
      const key = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc';
      serveLab({
        remotes: [
          upstream({
            components: 'main',
            architectures: null,
            sync_udebs: true,
            gpgkey: key,
          }),
        ],
      });
      render('/deb/remotes/upstream/');

      const rows = await detailRows('Remote name');
      expect(rows.get('Distributions')).toHaveTextContent('bookworm');
      expect(rows.get('Components')).toHaveTextContent('main');
      expect(rows.get('Architectures')).toHaveTextContent('All');
      expect(rows.get('Sync sources')).toHaveTextContent('Disabled');
      expect(rows.get('Sync installer packages')).toHaveTextContent('Enabled');
      expect(rows.get('Sync installer files')).toHaveTextContent('Disabled');
      expect(rows.get('GPG key')).toHaveTextContent('BEGIN PGP PUBLIC KEY');
    });
  },
);

describe(
  'Integration: the deb repository screens',
  { tags: ['integration'] },
  () => {
    const manuals = (overrides: Partial<Repository> = {}) =>
      pluginRepository('deb', {
        name: 'bookworm-mirror',
        autopublish: true,
        publish_upstream_release_fields: false,
        ...overrides,
      });

    it('shows the rows of every repository and the deb rows in one list', async () => {
      serveLab({ repositories: [manuals({ retain_repo_versions: 5 })] });
      render('/deb/repositories/bookworm-mirror/');

      const rows = await detailRows('Repository name');
      expect(Array.from(rows.keys())).toEqual([
        'Repository name',
        'Description',
        'Retained version count',
        'Autopublish',
        'Publish upstream release fields',
        'Repository URL',
        'Labels',
        'Remote',
        'Last sync',
      ]);
      expect(rows.get('Retained version count')).toHaveTextContent('5');
      expect(rows.get('Autopublish')).toHaveTextContent('Enabled');
      expect(rows.get('Publish upstream release fields')).toHaveTextContent(
        'Disabled',
      );
    });

    it('lists the repositories with a Sync, Edit, Delete menu where a remote is set and no Sync where it is not', async () => {
      const remote = upstream();
      serveLab({
        remotes: [remote],
        repositories: [
          manuals({ name: 'synced', remote: remote.pulp_href }),
          manuals({ name: 'alone' }),
        ],
      });
      const { user } = render('/deb/repositories');

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

    it('shows the command line of a distribution with the suite left to fill in, quoted', async () => {
      const repository = manuals();
      serveLab({
        repositories: [repository],
        distributions: [
          pluginDistribution('deb', {
            name: 'bookworm-dist',
            base_path: 'bookworm',
            base_url: 'https://pulp.example/pulp/content/bookworm/',
            repository: repository.pulp_href,
          }),
        ],
        publications: [
          pluginPublication('deb', { repository: repository.pulp_href }),
        ],
      });
      render('/deb/repositories/bookworm-mirror/distributions');

      const line = await screen.findByText(/--distributions/);
      expect(line.textContent).toBe(
        "pulp deb remote create --name 'bookworm-mirror' --url 'https://pulp.example/pulp/content/bookworm/' --distributions '<suite>'",
      );
    });
  },
);

describe('Integration: the deb sync dialog', { tags: ['integration'] }, () => {
  it('starts with mirror off even for a repository that publishes by itself, optimize on, and sends them with the remote', async () => {
    const repository = pluginRepository('deb', {
      name: 'bookworm-mirror',
      autopublish: true,
      remote: `${REMOTE_PATH}00000000-0000-4000-8000-000000000999/`,
    });
    serveSyncLab({ repository });
    const syncs: Record<string, unknown>[] = [];
    server.use(
      http.post(
        `*${API}/repositories/deb/apt/:id/sync/`,
        async ({ request }) => {
          syncs.push((await request.json()) as Record<string, unknown>);
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      ),
    );
    const { user } = renderWithProviders(
      <SyncDialog
        descriptor={debDescriptor}
        repository={repository}
        onClose={() => undefined}
      />,
    );

    const mirror = screen.getByRole('switch', {
      name: /Content not present in remote repository/,
    });
    expect(mirror).not.toBeChecked();
    expect(mirror).toBeEnabled();
    expect(
      screen.getByRole('switch', { name: /Only perform the sync if changes/ }),
    ).toBeChecked();
    await user.click(screen.getByRole('button', { name: /^Sync/ }));

    await waitFor(() => expect(syncs).toHaveLength(1));
    expect(syncs[0]).toStrictEqual({
      remote: repository.remote,
      mirror: false,
      optimize: true,
    });
  });
});
