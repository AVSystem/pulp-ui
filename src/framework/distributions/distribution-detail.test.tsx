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
  contentGuard,
  contentGuardListHandler,
  corePublicationListHandler,
  coreRepositoryListHandler,
  distributionListHandler,
  listOf,
  page,
  pluginDistribution,
  pluginPublication,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  role,
  roleAssignment,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';

const manifestOf = (plugin: string): PluginManifest => ({
  ...(PLUGIN_MANIFESTS.find(
    (entry) => entry.plugin === plugin,
  ) as PluginManifest),
  onFramework: true,
});

function Routed({ plugin }: { plugin: string }) {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardRoutes(frameworkRoutes([manifestOf(plugin)])))}
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

function renderDetail(
  route = '/file/distributions/tools-dist/',
  plugin = 'file',
) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed plugin={plugin} />
      </PermissionsKnown>
    </AppContextProvider>,
    { route, signedIn: true },
  );
}

type Publication = ReturnType<typeof pluginPublication>;

// The server of a lab: the plugin's own list of distributions, the lists that
// name repositories, publications and guards by address, the plugin's own
// publications, and every request any of them answers.
function serveLab({
  plugin = 'file',
  distributions,
  repositories = [],
  publications = [],
  guards = [],
}: {
  plugin?: TestDistributionPlugin;
  distributions: IDistribution[];
  repositories?: IRepository[];
  publications?: Publication[];
  guards?: ReturnType<typeof contentGuard>[];
}) {
  const lab = {
    distributions: distributionListHandler(plugin, distributions),
    repositories: coreRepositoryListHandler(repositories),
    corePublications: corePublicationListHandler(publications),
    guards: contentGuardListHandler(guards),
    ownPublications:
      plugin === 'file' || plugin === 'deb' || plugin === 'rpm'
        ? publicationListHandler(plugin, publications)
        : null,
  };
  server.use(
    lab.distributions.handler,
    lab.repositories.handler,
    lab.corePublications.handler,
    lab.guards.handler,
    ...(lab.ownPublications ? [lab.ownPublications.handler] : []),
    // read for a user who is not an administrator
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return lab;
}

// The rows of the page as label -> the element that holds the value.
async function rowsOfPage() {
  const first = await screen.findByText('Client URL');
  const list = first.closest('dl') as HTMLElement;
  const rows = new Map<string, HTMLElement>();
  for (const group of Array.from(list.querySelectorAll(':scope > div'))) {
    const term = group.querySelector('dt')?.textContent as string;
    rows.set(term, group.querySelector('dd') as HTMLElement);
  }
  return rows;
}

const row = (rows: Map<string, HTMLElement>, label: string) =>
  rows.get(label) as HTMLElement;

const URL_A = 'https://pulp.example/pulp/content/served/tools/';

const at = (repository: IRepository, version: number) => ({
  ...repository,
  latest_version_href: `${repository.pulp_href}versions/${version}/`,
});

const made = (repository: IRepository, version: number) =>
  pluginPublication('file', {
    repository: repository.pulp_href,
    repository_version: `${repository.pulp_href}versions/${version}/`,
  });

describe(
  'Integration: the distribution detail',
  { tags: ['integration'] },
  () => {
    it('shows the client URL, what the distribution serves, the guard by name and type, the base path, the creation time and the labels', async () => {
      const repository = pluginRepository('file', { name: 'tools-repo' });
      const guard = contentGuard({ name: 'customers-only' });
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_path: 'served/tools',
            base_url: URL_A,
            repository: repository.pulp_href,
            content_guard: guard.pulp_href,
            pulp_labels: { team: 'docs' },
            pulp_created: '2024-03-02T10:00:00.000000Z',
          }),
        ],
        repositories: [repository],
        publications: [made(repository, 0)],
        guards: [guard],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(screen.getByRole('heading', { name: /tools-dist/ })).toBeVisible();
      expect(within(row(rows, 'Client URL')).getByText(URL_A)).toBeVisible();
      expect(row(rows, 'Base path')).toHaveTextContent('served/tools');
      const serves = row(rows, 'Serves');
      await waitFor(() =>
        expect(
          within(serves).getByRole('link', { name: 'tools-repo' }),
        ).toHaveAttribute('href', '/file/repositories/tools-repo/'),
      );
      await waitFor(() =>
        expect(row(rows, 'Content guard')).toHaveTextContent(
          'customers-only (rbac)',
        ),
      );
      expect(within(row(rows, 'Labels')).getByText('team: docs')).toBeVisible();
      expect(row(rows, 'Created')).toHaveTextContent(/ago/);
    });

    it('tells a guarded URL cannot be opened in a browser, and marks an unguarded one Public', async () => {
      const guard = contentGuard({ name: 'customers-only' });
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_url: URL_A,
            content_guard: guard.pulp_href,
          }),
        ],
        guards: [guard],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(
        within(row(rows, 'Client URL')).getByText(/Downloads need credentials/),
      ).toBeVisible();
      expect(within(row(rows, 'Client URL')).queryByText('Public')).toBeNull();
    });

    it('marks a distribution without a content guard as Public beside the URL and in the guard row', async () => {
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            base_url: URL_A,
            content_guard: null,
          }),
        ],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(within(row(rows, 'Client URL')).getByText('Public')).toBeVisible();
      expect(
        within(row(rows, 'Content guard')).getByText('Public'),
      ).toBeVisible();
      expect(
        within(row(rows, 'Client URL')).queryByText(
          /Downloads need credentials/,
        ),
      ).toBeNull();
    });

    it('shows a guard the user may not read without a name', async () => {
      const hidden = contentGuard({ name: 'secret' });
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            content_guard: hidden.pulp_href,
          }),
        ],
        guards: [],
      });

      renderDetail();
      const rows = await rowsOfPage();

      await waitFor(() =>
        expect(row(rows, 'Content guard')).toHaveTextContent(
          'A content guard you may not see',
        ),
      );
      expect(screen.queryByText('secret')).toBeNull();
    });

    it('tells an administrator the version served and the latest one of a stale distribution', async () => {
      const repository = at(
        pluginRepository('file', { name: 'tools-repo' }),
        2,
      );
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            repository: repository.pulp_href,
          }),
        ],
        repositories: [repository],
        publications: [made(repository, 1)],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Client URL')).findByText(
          'Serves version 1, latest is 2',
        ),
      ).toBeVisible();
    });

    it('says a repository-bound distribution without a publication serves nothing', async () => {
      const repository = pluginRepository('file', { name: 'tools-repo' });
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            repository: repository.pulp_href,
          }),
        ],
        repositories: [repository],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Client URL')).findByText(
          'Serves nothing (404): no publication',
        ),
      ).toBeVisible();
    });

    it('says a distribution bound to nothing is not bound to anything', async () => {
      serveLab({
        distributions: [pluginDistribution('file', { name: 'tools-dist' })],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Client URL')).findByText(
          'Not bound to anything',
        ),
      ).toBeVisible();
      expect(row(rows, 'Serves')).toHaveTextContent('Nothing');
    });

    it('names the publication a publication-bound distribution serves, with its version', async () => {
      const repository = at(
        pluginRepository('file', { name: 'tools-repo' }),
        3,
      );
      const publication = made(repository, 3);
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            publication: publication.pulp_href,
          }),
        ],
        repositories: [repository],
        publications: [publication],
      });

      renderDetail();
      const rows = await rowsOfPage();

      await waitFor(() =>
        expect(row(rows, 'Serves')).toHaveTextContent(
          'Publication of version 3',
        ),
      );
    });

    it('says "Cannot be checked" to a user who may not read the publications, never that it serves nothing', async () => {
      serveAccount({ isStaff: false, own: [['file.view_filedistribution']] });
      const repository = pluginRepository('file', { name: 'tools-repo' });
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            repository: repository.pulp_href,
          }),
        ],
        repositories: [repository],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Client URL')).findByText('Cannot be checked'),
      ).toBeVisible();
      expect(screen.queryByText(/Serves nothing/)).toBeNull();
    });

    it('shows the deprecated-publication note on a python distribution bound to a publication', async () => {
      const repository = pluginRepository('python', { name: 'wheels' });
      const publication = pluginPublication('python', {
        repository: repository.pulp_href,
        repository_version: `${repository.pulp_href}versions/0/`,
      });
      serveLab({
        plugin: 'python',
        distributions: [
          pluginDistribution('python', {
            name: 'tools-dist',
            base_url: URL_A,
            publication: publication.pulp_href,
          }),
        ],
        repositories: [repository],
        publications: [publication],
      });

      renderDetail('/python/distributions/tools-dist/', 'python');
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Client URL')).findByText(
          'Bound to a deprecated publication',
        ),
      ).toBeVisible();
      expect(screen.queryByText(/Serves nothing/)).toBeNull();
    });

    it("shows the client address of an ansible distribution from the plugin's own field", async () => {
      serveLab({
        plugin: 'ansible',
        distributions: [
          pluginDistribution('ansible', {
            name: 'tools-dist',
            client_url: 'https://pulp.example/pulp_ansible/galaxy/tools/',
          }),
        ],
      });

      renderDetail('/ansible/distributions/tools-dist/', 'ansible');
      const rows = await rowsOfPage();

      expect(
        within(row(rows, 'Client URL')).getByText(
          'https://pulp.example/pulp_ansible/galaxy/tools/',
        ),
      ).toBeVisible();
    });

    it('reads the distribution by its name with one request, and the repository and its publications with single reads, never the plugin-wide indexes', async () => {
      const repository = at(
        pluginRepository('file', { name: 'tools-repo' }),
        1,
      );
      const lab = serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            repository: repository.pulp_href,
          }),
        ],
        repositories: [repository],
        publications: [made(repository, 1)],
      });

      renderDetail();
      const rows = await rowsOfPage();
      await waitFor(() =>
        expect(row(rows, 'Serves')).toHaveTextContent('tools-repo'),
      );
      await waitFor(() => expect(lab.ownPublications?.queries.length).toBe(1));

      expect(lab.distributions.queries).toHaveLength(1);
      const byName = lab.distributions.queries[0] as URLSearchParams;
      expect(byName.get('name')).toBe('tools-dist');
      expect(byName.get('limit')).toBe('1');
      expect(lab.repositories.queries).toHaveLength(1);
      expect(
        (lab.ownPublications?.queries[0] as URLSearchParams).get('repository'),
      ).toBe(repository.pulp_href);
    });
  },
);

describe(
  'Integration: the errors of the distribution detail',
  { tags: ['integration'] },
  () => {
    it('shows Not Found after one read for a name no distribution has', async () => {
      const lab = serveLab({
        distributions: [pluginDistribution('file', { name: 'other' })],
      });

      renderDetail('/file/distributions/missing/');

      expect(await screen.findByText(/Page not found/i)).toBeVisible();
      expect(lab.distributions.queries).toHaveLength(1);
    });

    it("shows the insufficient permissions page with Pulp's reason when the read is refused", async () => {
      serveLab({ distributions: [] });
      server.use(
        http.get(`*${API}/distributions/file/file/`, () =>
          HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
        ),
      );

      renderDetail();

      expect(await screen.findByText('Not for you.')).toBeVisible();
    });

    it('shows the error state with Retry when the read fails, and reads again on Retry', async () => {
      const lab = serveLab({
        distributions: [pluginDistribution('file', { name: 'tools-dist' })],
      });
      server.use(
        http.get(`*${lab.distributions.path}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const { user } = renderDetail();

      expect(
        await screen.findByText('Distribution could not be displayed.'),
      ).toBeVisible();
      server.use(lab.distributions.handler);
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Client URL')).toBeVisible();
    });

    it('says the reads of what it serves failed and offers Retry, never reading as nothing', async () => {
      const repository = pluginRepository('file', { name: 'tools-repo' });
      const lab = serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            repository: repository.pulp_href,
          }),
        ],
        repositories: [repository],
      });
      server.use(
        http.get(`*${API}/repositories/`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const { user } = renderDetail();
      const rows = await rowsOfPage();

      expect(
        await within(row(rows, 'Serves')).findByText('Not loaded'),
      ).toBeVisible();
      server.use(lab.repositories.handler);
      await user.click(await screen.findByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(row(rows, 'Serves')).toHaveTextContent('tools-repo'),
      );
    });
  },
);

describe(
  'Integration: the labels and the actions of the distribution detail',
  { tags: ['integration'] },
  () => {
    const CHANGE = 'file.change_filedistribution';
    const DELETE = 'file.delete_filedistribution';

    const holding = (...permissions: string[]) =>
      serveAccount({ isStaff: false, own: [permissions] });

    function serveLabelWrites() {
      const sent: { path: string; body: unknown }[] = [];
      server.use(
        http.post(
          `*${API}/distributions/file/file/:id/set_label/`,
          async ({ request }) => {
            const body = await request.json();
            sent.push({ path: new URL(request.url).pathname, body });
            return HttpResponse.json(body);
          },
        ),
        http.post(
          `*${API}/distributions/file/file/:id/unset_label/`,
          async ({ request }) => {
            const body = await request.json();
            sent.push({ path: new URL(request.url).pathname, body });
            return HttpResponse.json(body);
          },
        ),
      );
      return sent;
    }

    it('adds a label with set_label on the distribution address for a user who holds the change permission', async () => {
      holding(CHANGE);
      const distribution = pluginDistribution('file', {
        name: 'tools-dist',
        pulp_labels: { team: 'docs' },
      });
      serveLab({ distributions: [distribution] });
      const sent = serveLabelWrites();

      const { user } = renderDetail();
      await rowsOfPage();
      await user.click(
        await screen.findByRole('button', { name: 'Edit labels' }),
      );
      await user.type(screen.getByLabelText('Label key'), 'tier');
      await user.type(screen.getByLabelText('Label value'), 'gold');
      await user.click(screen.getByRole('button', { name: 'Add label' }));

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual({
        path: `${distribution.pulp_href}set_label/`,
        body: { key: 'tier', value: 'gold' },
      });
    });

    it('removes a label with unset_label on the distribution address', async () => {
      holding(CHANGE);
      const distribution = pluginDistribution('file', {
        name: 'tools-dist',
        pulp_labels: { team: 'docs' },
      });
      serveLab({ distributions: [distribution] });
      const sent = serveLabelWrites();

      const { user } = renderDetail();
      await rowsOfPage();
      await user.click(
        await screen.findByRole('button', { name: 'Edit labels' }),
      );
      await user.click(
        screen.getByRole('button', { name: /close.*team|remove.*team/i }),
      );

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual({
        path: `${distribution.pulp_href}unset_label/`,
        body: { key: 'team' },
      });
    });

    it('lets a user who holds the change permission only through an object role edit the labels', async () => {
      const distribution = pluginDistribution('file', {
        name: 'tools-dist',
        pulp_labels: {},
      });
      serveAccount({ isStaff: false, own: [[]] });
      serveLab({ distributions: [distribution] });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [
            roleAssignment(
              'file.filedistribution_owner',
              distribution.pulp_href,
            ),
          ],
          {
            pageSize: 1000,
            matching: (rowOf, query) =>
              query.get('content_object') !== 'null' ||
              rowOf.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(
            page([
              role({
                name: 'file.filedistribution_owner',
                permissions: [CHANGE, DELETE],
              }),
            ]),
          ),
        ),
      );

      renderDetail();
      await rowsOfPage();

      expect(
        await screen.findByRole('button', { name: 'Edit labels' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
    });

    it('offers Edit beside Delete to a user who may change the distribution, and opens its edit form', async () => {
      serveLab({
        distributions: [pluginDistribution('file', { name: 'tools-dist' })],
      });

      const { user } = renderDetail();
      await rowsOfPage();
      await user.click(await screen.findByRole('button', { name: 'Edit' }));

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/distributions/tools-dist/edit',
      );
    });

    it('offers Edit to a user who holds the change permission only through an object role', async () => {
      const distribution = pluginDistribution('file', { name: 'tools-dist' });
      serveAccount({ isStaff: false, own: [[]] });
      serveLab({ distributions: [distribution] });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [
            roleAssignment(
              'file.filedistribution_owner',
              distribution.pulp_href,
            ),
          ],
          {
            pageSize: 1000,
            matching: (rowOf, query) =>
              query.get('content_object') !== 'null' ||
              rowOf.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(
            page([
              role({
                name: 'file.filedistribution_owner',
                permissions: [CHANGE],
              }),
            ]),
          ),
        ),
      );

      renderDetail();
      await rowsOfPage();

      expect(await screen.findByRole('button', { name: 'Edit' })).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    });

    it('shows the labels without an editor and offers no Delete to a user who holds neither permission', async () => {
      holding();
      serveLab({
        distributions: [
          pluginDistribution('file', {
            name: 'tools-dist',
            pulp_labels: { team: 'docs' },
          }),
        ],
      });

      renderDetail();
      const rows = await rowsOfPage();

      expect(within(row(rows, 'Labels')).getByText('team: docs')).toBeVisible();
      await waitFor(() =>
        expect(
          screen.queryByRole('button', { name: 'Edit labels' }),
        ).toBeNull(),
      );
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    });

    it('opens the delete dialog for an allowed user, deletes, and returns to the distribution list', async () => {
      holding(DELETE);
      const distribution = pluginDistribution('file', {
        name: 'tools-dist',
        base_path: 'served/tools',
      });
      serveLab({ distributions: [distribution] });
      const deletes: string[] = [];
      server.use(
        http.delete(`*${API}/distributions/file/file/:id/`, ({ request }) => {
          deletes.push(new URL(request.url).pathname);
          return HttpResponse.json({
            task: `${API}/tasks/00000000-0000-4000-8000-00000000d001/`,
          });
        }),
        http.get(`*${API}/tasks/*`, () =>
          HttpResponse.json({
            pulp_href: `${API}/tasks/00000000-0000-4000-8000-00000000d001/`,
            state: 'running',
          }),
        ),
      );

      const { user } = renderDetail();
      await rowsOfPage();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Delete distribution?')).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/distributions',
        ),
      );
      expect(deletes).toEqual([distribution.pulp_href]);
    });

    it('sends nothing when the delete dialog is cancelled', async () => {
      holding(DELETE);
      serveLab({
        distributions: [pluginDistribution('file', { name: 'tools-dist' })],
      });
      const deletes: string[] = [];
      server.use(
        http.delete(`*${API}/distributions/file/file/:id/`, ({ request }) => {
          deletes.push(request.url);
          return HttpResponse.json({}, { status: 202 });
        }),
      );

      const { user } = renderDetail();
      await rowsOfPage();
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(deletes).toEqual([]);
    });
  },
);
