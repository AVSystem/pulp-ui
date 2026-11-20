import type { MessageDescriptor } from '@lingui/core';
import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import fileDescriptor from 'src/descriptors/file/descriptor';
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
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
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
        'Repository URL',
        'Labels',
        'Remote',
      ]);
      expect(rows.get('Repository name')).toHaveTextContent('tools');
      expect(rows.get('Description')).toHaveTextContent(
        'Mirror of the manuals',
      );
      expect(rows.get('Retained version count')).toHaveTextContent('3');
      expect(rows.get('Autopublish')).toHaveTextContent('Enabled');
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
      expect(within(urls).queryByText(/Not served/)).toBeNull();
    });

    it('says Not served next to a distribution whose repository has no publication', async () => {
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
          /Not served/,
        ),
      ).toBeVisible();
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
