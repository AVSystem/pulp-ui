import type { MessageDescriptor } from '@lingui/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import fileDescriptor from 'src/descriptors/file/descriptor';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { servePublishLab } from 'src/test-utils/publish-lab';
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
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { SYNC_TASK, report, serveSyncLab } from 'src/test-utils/sync-lab';
import type { PluginDescriptor } from '../descriptor';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { RepositoryDetail } from './repository-detail';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

type Repository = ReturnType<typeof pluginRepository>;

interface Lab {
  repositories: Repository[];
  distributions?: ReturnType<typeof pluginDistribution>[];
  publications?: ReturnType<typeof pluginPublication>[];
  remotes?: ReturnType<typeof pluginRemote>[];
}

// Every list the repository detail reads, answered the way the server answers
// it. The remotes are the generic list of every plugin's remotes.
function serveLab({
  repositories,
  distributions = [],
  publications = [],
  remotes = [],
}: Lab) {
  const lab = {
    repositories: pluginListHandler('file', 'repository', repositories),
    distributions: distributionListHandler('file', distributions),
    publications: publicationListHandler('file', publications),
    remotes: listOf(`${API}/remotes/`, remotes, {
      pageSize: 1000,
      matching: (row, query) => {
        const hrefs = inSetOf(query, 'pulp_href__in');
        return hrefs === null || hrefs.includes(row.pulp_href);
      },
      projected: projectedBy,
    }),
  };
  server.use(
    lab.repositories.handler,
    lab.distributions.handler,
    lab.publications.handler,
    lab.remotes.handler,
  );
  return lab;
}

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
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
});

// The detail screen with a descriptor of the test's own making.
function DetailRoutes({ descriptor }: { descriptor: PluginDescriptor }) {
  return (
    <Routes>
      <Route
        path='/file/repositories/:name/*'
        element={
          <RepositoryDetail plugin='file' descriptor={descriptor} tab={null} />
        }
      />
    </Routes>
  );
}

function renderDetail(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

// The Details rows as label -> the element holding the value.
async function detailRows() {
  const first = await screen.findByText('Repository name');
  const list = first.closest('dl') as HTMLElement;
  const rows = new Map<string, HTMLElement>();
  for (const group of Array.from(list.querySelectorAll(':scope > div'))) {
    const term = group.querySelector('dt')?.textContent as string;
    rows.set(term, group.querySelector('dd') as HTMLElement);
  }
  return rows;
}

const PYTHON: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'python',
  ) as PluginManifest),
  onFramework: true,
};

function PythonRouted() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([PYTHON])))}
    </>
  );
}

function renderPythonDetail(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <PythonRouted />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const rowOf = async (name: string) =>
  (await screen.findByText(name)).closest('tr') as HTMLElement;

const tools = (overrides: Partial<Repository> = {}) =>
  pluginRepository('file', { name: 'tools', ...overrides });

describe(
  'Integration: the Details tab of the repository detail',
  { tags: ['integration'] },
  () => {
    it('shows the rows of every repository and the rows the plugin adds, in one list', async () => {
      const repository = tools({
        description: 'Mirror of the manuals',
        retain_repo_versions: 3,
        autopublish: true,
        sha256sums: 'root',
        pulp_labels: { team: 'docs', tier: null },
      });
      serveLab({ repositories: [repository] });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(Array.from(rows.keys())).toEqual([
        'Repository name',
        'Description',
        'Retained version count',
        'Autopublish',
        'SHA256SUMS files',
        'Repository URL',
        'Labels',
        'Remote',
        'Last sync',
      ]);
      expect(rows.get('Repository name')).toHaveTextContent('tools');
      expect(rows.get('Description')).toHaveTextContent(
        'Mirror of the manuals',
      );
      expect(rows.get('Retained version count')).toHaveTextContent('3');
      expect(rows.get('Autopublish')).toHaveTextContent('Enabled');
      expect(rows.get('SHA256SUMS files')).toHaveTextContent(
        'One file at the root',
      );
      expect(within(rows.get('Labels') as HTMLElement).getByText('team: docs'));
      expect(within(rows.get('Labels') as HTMLElement).getByText('tier'));
    });

    it('shows None for an empty description, All for no retention limit, Disabled for autopublish off, None for no remote and no distribution', async () => {
      serveLab({
        repositories: [
          tools({ description: '', autopublish: false, remote: null }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(rows.get('Description')).toHaveTextContent('None');
      expect(rows.get('Retained version count')).toHaveTextContent('All');
      expect(rows.get('Autopublish')).toHaveTextContent('Disabled');
      expect(rows.get('Remote')).toHaveTextContent('None');
      await waitFor(() =>
        expect(rows.get('Repository URL')).toHaveTextContent('None'),
      );
    });

    it.each([
      ['disabled', 'Disabled'],
      ['root', 'One file at the root'],
      ['directory', 'One file in every directory'],
      [undefined, 'Not available'],
    ])('shows the SHA256SUMS row for %s as %s', async (sha256sums, shown) => {
      serveLab({ repositories: [tools({ sha256sums })] });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(rows.get('SHA256SUMS files')).toHaveTextContent(shown);
    });

    it('shows the autopublish row once, also when the server leaves the flag out', async () => {
      serveLab({ repositories: [tools()] });

      renderDetail('/file/repositories/tools/');

      await detailRows();
      expect(screen.getAllByText('Autopublish')).toHaveLength(1);
    });

    it('shows no last-updated line even when the repository carries a last sync task', async () => {
      serveLab({
        repositories: [
          tools({
            last_sync_task: {
              state: 'completed',
              finished_at: '2000-01-02T00:00:00.000000Z',
            },
          }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      await detailRows();
      expect(screen.queryByText(/Last updated from registry/)).toBeNull();
    });

    it('shows the URL the server reports for each distribution that serves the repository, never one built from the base path', async () => {
      const repository = tools();
      const publication = pluginPublication('file', {
        repository: repository.pulp_href,
      });
      serveLab({
        repositories: [repository],
        publications: [publication],
        distributions: [
          pluginDistribution('file', {
            name: 'first',
            base_path: 'first',
            base_url: 'https://pulp.example/mirror-one/first/',
            repository: repository.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'second',
            base_path: 'second',
            base_url: 'https://pulp.example/mirror-two/other/',
            publication: publication.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'foreign',
            base_url: 'https://pulp.example/foreign/',
            repository: pluginRepository('file').pulp_href,
          }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const urls = rows.get('Repository URL') as HTMLElement;
      expect(
        await within(urls).findByText('https://pulp.example/mirror-one/first/'),
      ).toBeVisible();
      expect(
        within(urls).getByText('https://pulp.example/mirror-two/other/'),
      ).toBeVisible();
      expect(within(urls).queryByText(/foreign/)).toBeNull();
      expect(within(urls).queryByText(/\/pulp\/content\/first/)).toBeNull();
      // more than one distribution: each is named
      expect(within(urls).getByText('first')).toBeVisible();
      expect(within(urls).queryByText(/Serves nothing/)).toBeNull();
      expect(within(urls).queryByText(/Cannot be checked/)).toBeNull();
    });

    it('says a distribution serves nothing when its repository has no publication, to a user who may read publications', async () => {
      const repository = tools();
      serveLab({
        repositories: [repository],
        distributions: [
          pluginDistribution('file', {
            name: 'bare',
            repository: repository.pulp_href,
          }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(
        await within(rows.get('Repository URL') as HTMLElement).findByText(
          'Serves nothing (404): no publication',
        ),
      ).toBeVisible();
    });

    it('says Cannot be checked, never that it serves nothing, to a user who may not read publications', async () => {
      serveAccount({ isStaff: false });
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);
      const repository = tools();
      serveLab({
        repositories: [repository],
        distributions: [
          pluginDistribution('file', {
            name: 'bare',
            repository: repository.pulp_href,
          }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const urls = rows.get('Repository URL') as HTMLElement;
      expect(await within(urls).findByText('Cannot be checked')).toBeVisible();
      expect(within(urls).queryByText(/Serves nothing/)).toBeNull();
    });

    it('says which version an older publication serves, on the Details tab', async () => {
      const repository = tools({
        latest_version_href:
          '/pulp/api/v3/repositories/file/file/x/versions/2/',
      });
      serveLab({
        repositories: [repository],
        distributions: [
          pluginDistribution('file', {
            name: 'older',
            repository: repository.pulp_href,
          }),
        ],
        publications: [
          pluginPublication('file', {
            repository: repository.pulp_href,
            repository_version: `${repository.pulp_href}versions/1/`,
          }),
        ],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(
        await within(rows.get('Repository URL') as HTMLElement).findByText(
          'Serves version 1, latest is 2',
        ),
      ).toBeVisible();
    });

    it('gives a python distribution bound to the repository no warning and one bound to a publication the note that publications are deprecated', async () => {
      const repository = pluginRepository('python', { name: 'wheels' });
      const published = pluginPublication('python', {
        repository: repository.pulp_href,
      });
      server.use(
        pluginListHandler('python', 'repository', [repository]).handler,
        distributionListHandler('python', [
          pluginDistribution('python', {
            name: 'by-repository',
            base_url: 'https://pulp.example/pypi/by-repository/',
            repository: repository.pulp_href,
          }),
          pluginDistribution('python', {
            name: 'by-publication',
            base_url: 'https://pulp.example/pypi/by-publication/',
            publication: published.pulp_href,
          }),
        ]).handler,
        publicationListHandler('python', [published]).handler,
        listOf(`${API}/remotes/`, [], { pageSize: 1000 }).handler,
      );

      renderPythonDetail('/python/repositories/wheels/distributions');

      const bound = (await rowOf('by-publication')) as HTMLElement;
      expect(
        within(bound).getByText('Bound to a deprecated publication'),
      ).toBeVisible();
      const plain = (await rowOf('by-repository')) as HTMLElement;
      expect(within(plain).queryByText(/deprecated/)).toBeNull();
      expect(within(plain).queryByText(/Serves nothing/)).toBeNull();
      expect(within(plain).queryByText(/Cannot be checked/)).toBeNull();
    });

    it('says why the distributions are missing when they cannot be read, instead of None, and reads again on Retry', async () => {
      const repository = tools();
      let answers = 0;
      serveLab({ repositories: [repository] });
      server.use(
        http.get(`*${API}/distributions/file/file/`, () => {
          answers += 1;
          return answers === 1
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(
                page([
                  pluginDistribution('file', {
                    name: 'only',
                    base_url: 'https://pulp.example/only/',
                    repository: repository.pulp_href,
                  }),
                ]),
              );
        }),
      );

      const { user } = renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const urls = rows.get('Repository URL') as HTMLElement;
      expect(
        await within(urls).findByText(/Distributions could not be loaded/),
      ).toBeVisible();
      expect(within(urls).queryByText('None')).toBeNull();

      await user.click(within(urls).getByRole('button', { name: 'Retry' }));

      expect(
        await within(urls).findByText('https://pulp.example/only/'),
      ).toBeVisible();
      expect(answers).toBe(2);
    });
  },
);

describe(
  'Integration: the remote of a repository',
  { tags: ['integration'] },
  () => {
    const remoteOfType = (type: string, name: string) => {
      const base = pluginRemote('file', { name });
      return {
        ...base,
        pulp_href: base.pulp_href.replace('remotes/file/file', type),
      };
    };

    it('names a remote of another type by reading the generic remote list once by address, and does not link it', async () => {
      const git = remoteOfType('remotes/file/git', 'upstream-git');
      const lab = serveLab({
        repositories: [tools({ remote: git.pulp_href })],
        remotes: [git, pluginRemote('file', { name: 'unrelated' })],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const cell = rows.get('Remote') as HTMLElement;
      expect(await within(cell).findByText('upstream-git')).toBeVisible();
      expect(within(cell).queryByRole('link')).toBeNull();

      expect(lab.remotes.queries).toHaveLength(1);
      const query = lab.remotes.queries[0] as URLSearchParams;
      expect(query.get('pulp_href__in')).toBe(git.pulp_href);
    });

    it('links a remote of the plugin to its page', async () => {
      const remote = pluginRemote('file', { name: 'mirror' });
      serveLab({
        repositories: [tools({ remote: remote.pulp_href })],
        remotes: [remote],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const link = await within(rows.get('Remote') as HTMLElement).findByRole(
        'link',
        { name: 'mirror' },
      );
      expect(link.getAttribute('href')).toMatch(/^\/file\/remotes\/mirror\/?$/);
    });

    it('reads no remote for a repository that has none', async () => {
      const lab = serveLab({ repositories: [tools({ remote: null })] });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(rows.get('Remote')).toHaveTextContent('None');
      await waitFor(() =>
        expect(rows.get('Repository URL')).toHaveTextContent('None'),
      );
      expect(lab.remotes.queries).toHaveLength(0);
    });

    it('says the remote could not be read and reads again on Retry', async () => {
      const remote = pluginRemote('file', { name: 'mirror' });
      let answers = 0;
      serveLab({
        repositories: [tools({ remote: remote.pulp_href })],
      });
      server.use(
        http.get(`*${API}/remotes/`, () => {
          answers += 1;
          return answers === 1
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(page([remote]));
        }),
      );

      const { user } = renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      const cell = rows.get('Remote') as HTMLElement;
      expect(
        await within(cell).findByText(/Remote could not be loaded/),
      ).toBeVisible();

      await user.click(within(cell).getByRole('button', { name: 'Retry' }));

      expect(
        await within(cell).findByRole('link', { name: 'mirror' }),
      ).toBeVisible();
    });

    it('says the remote is not available when the list does not hold it', async () => {
      const remote = pluginRemote('file', { name: 'mirror' });
      serveLab({
        repositories: [tools({ remote: remote.pulp_href })],
        remotes: [],
      });

      renderDetail('/file/repositories/tools/');

      const rows = await detailRows();
      expect(
        await within(rows.get('Remote') as HTMLElement).findByText(
          'Not available',
        ),
      ).toBeVisible();
    });
  },
);

describe(
  'Integration: the tabs of the repository detail',
  { tags: ['integration'] },
  () => {
    const label = (id: string) => ({ id }) as MessageDescriptor;
    const tab = (id: 'versions' | 'distributions', body: string) => ({
      id,
      label: label(id === 'versions' ? 'Versions' : 'Distributions'),
      render: () => <p>{body}</p>,
    });

    const descriptor: PluginDescriptor = {
      ...(fileDescriptor as unknown as PluginDescriptor),
      repository: {
        ...(fileDescriptor as unknown as PluginDescriptor).repository,
        tabs: [
          tab('versions', 'versions body'),
          tab('distributions', 'distributions body'),
        ],
      },
    };

    function renderTabs(route: string) {
      return renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <Routes>
              {[
                [null, '/file/repositories/:name'],
                ['versions', '/file/repositories/:name/versions'],
                ['distributions', '/file/repositories/:name/distributions'],
              ].map(([id, path]) => (
                <Route
                  key={path}
                  path={path as string}
                  element={
                    <RepositoryDetail
                      plugin='file'
                      descriptor={descriptor}
                      tab={id as 'versions' | 'distributions' | null}
                    />
                  }
                />
              ))}
            </Routes>
          </PermissionsKnown>
        </AppContextProvider>,
        { route },
      );
    }

    it('offers Details and the tabs of the descriptor as links to sub-paths, the active one following the address', async () => {
      serveLab({ repositories: [tools()] });

      renderTabs('/file/repositories/tools/distributions');

      expect(await screen.findByText('distributions body')).toBeVisible();
      const hrefs = Object.fromEntries(
        ['Details', 'Versions', 'Distributions'].map((name) => [
          name,
          screen.getByRole('link', { name }),
        ]),
      );
      expect(hrefs.Details?.getAttribute('href')).toMatch(
        /^\/file\/repositories\/tools\/?$/,
      );
      expect(hrefs.Versions?.getAttribute('href')).toMatch(
        /^\/file\/repositories\/tools\/versions\/?$/,
      );
      expect(hrefs.Distributions?.getAttribute('href')).toMatch(
        /^\/file\/repositories\/tools\/distributions\/?$/,
      );
      expect(hrefs.Distributions).toHaveAttribute('aria-current', 'page');
      expect(hrefs.Details).not.toHaveAttribute('aria-current');
    });
  },
);

describe(
  'Integration: the Edit action of the repository detail',
  { tags: ['integration'] },
  () => {
    const CHANGE = 'file.change_filerepository';

    it('offers Edit to a user who holds the change permission and leads to the edit address', async () => {
      serveAccount({ isStaff: false, own: [[CHANGE]] });
      serveLab({ repositories: [tools()] });
      // the delete permission is not held on every repository, so the roles
      // on single objects are read to see whether it is held on this one
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);

      const { user } = renderDetail('/file/repositories/tools/');

      await user.click(await screen.findByRole('button', { name: 'Edit' }));
      expect(screen.getByTestId('location').textContent).toBe(
        '/file/repositories/tools/edit/',
      );
    });

    it('offers Edit to a user who holds the change role on this repository only', async () => {
      const repository = tools();
      serveAccount({ isStaff: false });
      serveLab({ repositories: [repository] });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', repository.pulp_href)],
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
            page([role({ name: 'owner', permissions: [CHANGE] })]),
          ),
        ),
      );

      renderDetail('/file/repositories/tools/');

      expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
    });

    it('shows no Edit to a user who cannot be confirmed to hold the change permission', async () => {
      serveAccount({ isStaff: false });
      serveLab({ repositories: [tools()] });
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));

      renderDetail('/file/repositories/tools/');

      await detailRows();
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });
  },
);

describe(
  'Integration: syncing from the repository detail',
  { tags: ['integration'] },
  () => {
    const SYNC = 'file.sync_filerepository';
    const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`;
    let intervals: IIntervals;

    beforeEach(() => {
      intervals = trackIntervals();
    });
    afterEach(() => {
      intervals.restore();
    });

    const withRemote = () => tools({ remote: REMOTE });

    it('starts a sync from the dialog, closes it at once and shows the progress of the task to the end', async () => {
      const repository = withRemote();
      serveLab({ repositories: [repository] });
      const lab = serveSyncLab({ repository });
      const { user } = renderDetail('/file/repositories/tools/');

      await user.click(await screen.findByRole('button', { name: 'Sync' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Sync repository "tools"')).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Sync' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.syncs).toHaveLength(1);
      expect(lab.syncs[0].body).toEqual({
        remote: REMOTE,
        mirror: true,
        optimize: true,
      });
      expect(await screen.findByText('Sync queued')).toBeVisible();

      lab.change(lab.tasks[0].pulp_href, {
        state: 'running',
        progress_reports: [report('Downloading artifacts', 120, 300)],
      });
      intervals.run(2000);
      expect(await screen.findByText('120/300')).toBeVisible();
      expect(screen.getByText('Sync running')).toBeVisible();

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(2000);
      expect(await screen.findByText('Sync completed')).toBeVisible();
    });

    it('shows the progress of a sync that was started elsewhere on every tab', async () => {
      const repository = withRemote();
      serveLab({ repositories: [repository] });
      serveSyncLab({
        repository,
        tasks: [
          {
            state: 'running',
            progress_reports: [report('Downloading artifacts', 5, 50)],
          },
        ],
      });

      renderDetail('/file/repositories/tools/');

      expect(await screen.findByText('5/50')).toBeVisible();
    });

    it('offers Sync to a user who holds the sync permission', async () => {
      const repository = withRemote();
      serveAccount({ isStaff: false, own: [[SYNC]] });
      serveLab({ repositories: [repository] });
      serveSyncLab({ repository });
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);

      renderDetail('/file/repositories/tools/');

      expect(await screen.findByRole('button', { name: 'Sync' })).toBeVisible();
    });

    it('shows no Sync to a user who cannot be confirmed to hold the sync permission', async () => {
      const repository = withRemote();
      serveAccount({ isStaff: false });
      serveLab({ repositories: [repository] });
      serveSyncLab({ repository });
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));

      renderDetail('/file/repositories/tools/');

      await detailRows();
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
    });

    it('sends nothing to sync until Sync is pressed in the dialog', async () => {
      const repository = withRemote();
      serveLab({ repositories: [repository] });
      const lab = serveSyncLab({ repository });
      const { user } = renderDetail('/file/repositories/tools/');

      await user.click(await screen.findByRole('button', { name: 'Sync' }));
      await screen.findByRole('dialog');
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
      });

      expect(lab.syncs).toEqual([]);
    });
  },
);

describe(
  'Integration: the last sync on the repository detail',
  { tags: ['integration'] },
  () => {
    const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`;
    let intervals: IIntervals;

    beforeEach(() => {
      intervals = trackIntervals();
    });
    afterEach(() => {
      intervals.restore();
    });

    const lastSync = async () => (await detailRows()).get('Last sync');

    it('shows when the last sync ended, how it ended and a link to its task', async () => {
      const repository = tools({ remote: REMOTE });
      serveLab({ repositories: [repository] });
      const lab = serveSyncLab({
        repository,
        tasks: [
          {
            state: 'failed',
            finished_at: '2026-03-01T10:00:00.000000Z',
            pulp_created: '2026-03-01T09:59:00.000000Z',
          },
        ],
      });

      renderDetail('/file/repositories/tools/');

      const row = (await lastSync()) as HTMLElement;
      await waitFor(() =>
        expect(within(row).getByText('Failed')).toBeVisible(),
      );
      expect(row.querySelector('time')).toHaveAttribute(
        'datetime',
        '2026-03-01T10:00:00.000000Z',
      );
      expect(
        within(row).getByRole('link', { name: 'View the task' }),
      ).toHaveAttribute(
        'href',
        expect.stringMatching(/^\/tasks\/[0-9a-f-]{36}\/?$/),
      );
      const asked = lab.lists.filter(
        (query) => query.get('name') === SYNC_TASK,
      );
      expect(asked).toHaveLength(1);
      expect(asked[0].get('reserved_resources')).toBe(repository.pulp_href);
      expect(asked[0].get('page_size') ?? asked[0].get('limit')).toBe('1');
    });

    it('says Never synced for a repository no sync task names', async () => {
      const repository = tools({ remote: REMOTE });
      serveLab({ repositories: [repository] });
      serveSyncLab({ repository });

      renderDetail('/file/repositories/tools/');

      const row = (await lastSync()) as HTMLElement;
      await waitFor(() =>
        expect(within(row).getByText('Never synced')).toBeVisible(),
      );
      expect(screen.getByRole('button', { name: 'Sync' })).toBeVisible();
    });

    it('shows the result of the sync that ends while the page is open', async () => {
      const repository = tools({ remote: REMOTE });
      serveLab({ repositories: [repository] });
      const lab = serveSyncLab({ repository, tasks: [{ state: 'running' }] });

      renderDetail('/file/repositories/tools/');
      const row = (await lastSync()) as HTMLElement;
      await waitFor(() =>
        expect(within(row).getByText('Running')).toBeVisible(),
      );

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(2000);

      await waitFor(() =>
        expect(within(row).getByText('Completed')).toBeVisible(),
      );
    });

    it('says why sync is unavailable and offers no Sync anywhere on the page, for a repository with no remote', async () => {
      const repository = tools({ remote: null });
      serveLab({ repositories: [repository] });
      serveSyncLab({ repository });

      renderDetail('/file/repositories/tools/');

      const row = (await lastSync()) as HTMLElement;
      expect(
        within(row).getByText(
          'Sync is unavailable because this repository has no remote.',
        ),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Sync' })).toBeNull();
    });

    it('says the last sync could not be read and reads again on Retry', async () => {
      const repository = tools({ remote: REMOTE });
      serveLab({ repositories: [repository] });
      const lab = serveSyncLab({
        repository,
        tasks: [{ state: 'completed' }],
      });
      let fail = true;
      server.use(
        http.get(`*${API}/tasks/`, ({ request }) => {
          const query = new URL(request.url).searchParams;
          if (fail && query.get('name') === SYNC_TASK) {
            return HttpResponse.json({ detail: 'broken' }, { status: 500 });
          }
          return undefined;
        }),
      );
      const { user } = renderDetail('/file/repositories/tools/');

      const row = (await lastSync()) as HTMLElement;
      expect(
        await within(row).findByText('The last sync could not be read.'),
      ).toBeVisible();
      fail = false;
      await user.click(within(row).getByRole('button', { name: 'Retry' }));

      await waitFor(() =>
        expect(within(row).getByText('Completed')).toBeVisible(),
      );
      expect(lab.lists.length).toBeGreaterThan(0);
    });

    it('has no Last sync row for a plugin that declares no sync', async () => {
      const repository = tools({ remote: REMOTE });
      serveLab({ repositories: [repository] });
      const repositoryKind = { ...fileDescriptor.repository, sync: undefined };
      const withoutSync: PluginDescriptor = {
        ...fileDescriptor,
        repository: repositoryKind,
      };
      server.use(http.get(`*${API}/tasks/`, () => HttpResponse.json(page([]))));

      renderWithProviders(
        <AppContextProvider>
          <PermissionsKnown>
            <DetailRoutes descriptor={withoutSync} />
          </PermissionsKnown>
        </AppContextProvider>,
        { route: '/file/repositories/tools/' },
      );

      await detailRows();
      expect(screen.queryByText('Last sync')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Sync' })).toBeNull();
    });
  },
);

describe(
  'Integration: publishing from the repository detail',
  { tags: ['integration'] },
  () => {
    const ADD = 'file.add_filepublication';
    let intervals: IIntervals;

    beforeEach(() => {
      intervals = trackIntervals();
    });
    afterEach(() => {
      intervals.restore();
    });

    it('publishes the latest version from the dialog, closes it at once and shows the progress of the task to the end', async () => {
      const repository = tools();
      serveLab({ repositories: [repository] });
      const lab = servePublishLab({ repository });
      const { user } = renderDetail('/file/repositories/tools/');

      await user.click(await screen.findByRole('button', { name: 'Publish' }));
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText('Publish repository "tools"'),
      ).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.publishes).toEqual([{ repository: repository.pulp_href }]);
      expect(await screen.findByText('Publish queued')).toBeVisible();

      lab.change(lab.tasks[0].pulp_href, {
        state: 'running',
        progress_reports: [report('Publishing files', 12, 40)],
      });
      intervals.run(2000);
      expect(await screen.findByText('12/40')).toBeVisible();
      expect(screen.getByText('Publish running')).toBeVisible();

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(2000);
      expect(await screen.findByText('Publish completed')).toBeVisible();
    });

    it('offers Publish to a user who holds the add publication permission', async () => {
      const repository = tools();
      serveAccount({ isStaff: false, own: [[ADD]] });
      serveLab({ repositories: [repository] });
      servePublishLab({ repository });
      server.use(listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler);

      renderDetail('/file/repositories/tools/');

      expect(
        await screen.findByRole('button', { name: 'Publish' }),
      ).toBeVisible();
    });

    it('shows no Publish to a user who does not hold it, whatever role the user has on this repository', async () => {
      const repository = tools();
      serveAccount({ isStaff: false });
      serveLab({ repositories: [repository] });
      servePublishLab({ repository });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', repository.pulp_href)],
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
            page([role({ name: 'owner', permissions: [ADD] })]),
          ),
        ),
      );

      renderDetail('/file/repositories/tools/');

      await detailRows();
      expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });

    it('shows no Publish for a plugin that has no publications', async () => {
      const repository = pluginRepository('python', { name: 'wheels' });
      server.use(
        pluginListHandler('python', 'repository', [repository]).handler,
        distributionListHandler('python', []).handler,
        listOf(`${API}/remotes/`, [], { pageSize: 1000 }).handler,
      );

      renderPythonDetail('/python/repositories/wheels/');

      await detailRows();
      expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    });
  },
);
