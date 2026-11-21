import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRemote,
  type IRepository,
  listOf,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

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
  resetSessionEvents();
});

function renderDetail(route = '/file/remotes/mirror/') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route, signedIn: true },
  );
}

// The Details rows as label -> the element holding the value.
async function detailRows() {
  const first = await screen.findByText('Remote name');
  const list = first.closest('dl') as HTMLElement;
  const rows = new Map<string, HTMLElement>();
  for (const group of Array.from(list.querySelectorAll(':scope > div'))) {
    const term = group.querySelector('dt')?.textContent as string;
    rows.set(term, group.querySelector('dd') as HTMLElement);
  }
  return rows;
}

const mirror = (overrides: Partial<IRemote> = {}) =>
  pluginRemote('file', { name: 'mirror', ...overrides });

describe(
  'Integration: the Details tab of the remote detail',
  { tags: ['integration'] },
  () => {
    it('shows the rows every remote has, the rows the plugin adds, the repositories that use it and its labels, in one list', async () => {
      const remote = mirror({
        url: 'https://pulp.example/index/',
        proxy_url: 'https://proxy.example/',
        tls_validation: true,
        client_cert:
          '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----',
        ca_cert: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----',
        download_concurrency: 4,
        rate_limit: 100,
        policy: 'streamed',
        pulp_labels: { team: 'docs', tier: null },
      });
      serveLab({
        remotes: [remote, mirror({ name: 'other' })],
        repositories: [
          pluginRepository('file', { name: 'docs', remote: remote.pulp_href }),
        ],
      });

      renderDetail();

      const rows = await detailRows();
      expect(Array.from(rows.keys())).toEqual([
        'Remote name',
        'URL',
        'Proxy URL',
        'TLS validation',
        'Client certificate',
        'CA certificate',
        'Download concurrency',
        'Rate limit',
        'Download policy',
        'Stored credentials',
        'Repositories',
        'Labels',
      ]);
      expect(rows.get('Remote name')).toHaveTextContent('mirror');
      expect(rows.get('URL')).toHaveTextContent('https://pulp.example/index/');
      expect(rows.get('Proxy URL')).toHaveTextContent('https://proxy.example/');
      expect(rows.get('TLS validation')).toHaveTextContent('Enabled');
      expect(rows.get('Client certificate')).toHaveTextContent('client');
      expect(
        within(rows.get('Client certificate') as HTMLElement).getByRole(
          'button',
          { name: /download/i },
        ),
      ).toBeVisible();
      expect(rows.get('CA certificate')).toHaveTextContent('ca');
      expect(rows.get('Download concurrency')).toHaveTextContent('4');
      expect(rows.get('Rate limit')).toHaveTextContent('100');
      expect(rows.get('Download policy')).toHaveTextContent('Streamed');
      expect(
        await within(rows.get('Repositories') as HTMLElement).findByRole(
          'link',
          { name: 'docs' },
        ),
      ).toHaveAttribute('href', '/file/repositories/docs/');
      expect(within(rows.get('Labels') as HTMLElement).getByText('team: docs'));
      expect(within(rows.get('Labels') as HTMLElement).getByText('tier'));
    });

    it('shows None for what is not set', async () => {
      serveLab({
        remotes: [
          mirror({
            proxy_url: null,
            client_cert: null,
            ca_cert: null,
            download_concurrency: null,
            rate_limit: null,
            tls_validation: false,
          }),
        ],
      });

      renderDetail();

      const rows = await detailRows();
      for (const label of [
        'Proxy URL',
        'Client certificate',
        'CA certificate',
        'Download concurrency',
        'Rate limit',
        'Stored credentials',
        'Labels',
      ]) {
        expect(rows.get(label), label).toHaveTextContent('None');
      }
      expect(rows.get('TLS validation')).toHaveTextContent('Disabled');
      expect(
        await within(rows.get('Repositories') as HTMLElement).findByText(
          'Not used',
        ),
      ).toBeVisible();
    });

    it('shows a secret field only as set, by name, and never a value', async () => {
      serveLab({
        remotes: [
          mirror({
            hidden_fields: [
              { name: 'username', is_set: true },
              { name: 'password', is_set: true },
              { name: 'client_key', is_set: false },
            ],
            // a server that leaked a value would not make the page show it
            password: 'hunter2',
            client_key: 'secret-key-material',
          }),
        ],
      });

      renderDetail();

      const rows = await detailRows();
      expect(rows.get('Stored credentials')).toHaveTextContent(
        'Username, Password',
      );
      expect(rows.get('Stored credentials')).not.toHaveTextContent(
        'Client key',
      );
      expect(document.body).not.toHaveTextContent('hunter2');
      expect(document.body).not.toHaveTextContent('secret-key-material');
    });

    it('reads the remote by its name and the repositories that use it with one read of their own', async () => {
      const remote = mirror();
      const lab = serveLab({
        remotes: [remote],
        repositories: ['a', 'b', 'c'].map((name) =>
          pluginRepository('file', {
            name: `repo-${name}`,
            remote: remote.pulp_href,
          }),
        ),
      });

      renderDetail();
      await detailRows();
      await screen.findByRole('link', { name: 'repo-a' });

      expect(lab.remotes.queries).toHaveLength(1);
      expect(lab.remotes.queries[0]?.get('name')).toBe('mirror');
      expect(lab.repositories.queries).toHaveLength(1);
      expect(lab.repositories.queries[0]?.get('remote')).toBe(remote.pulp_href);
      expect(screen.getByRole('link', { name: 'repo-c' })).toBeVisible();
    });

    it('says how many more repositories use it than are named, and leads to them', async () => {
      const remote = mirror();
      serveLab({
        remotes: [remote],
        repositories: Array.from({ length: 14 }, (_, n) =>
          pluginRepository('file', {
            name: `repo-${String(n).padStart(2, '0')}`,
            remote: remote.pulp_href,
          }),
        ),
      });

      renderDetail();

      const more = await screen.findByRole('link', { name: '+4 more' });
      expect(more.getAttribute('href')).toContain(
        `?remote=${encodeURIComponent(remote.pulp_href)}`,
      );
      expect(screen.getByRole('link', { name: 'repo-09' })).toBeVisible();
      expect(screen.queryByRole('link', { name: 'repo-10' })).toBeNull();
    });

    it('shows Not Found after one read for a name no remote has', async () => {
      const lab = serveLab({ remotes: [mirror({ name: 'other' })] });

      renderDetail('/file/remotes/missing/');

      expect(await screen.findByText(/Page not found/i)).toBeVisible();
      expect(lab.remotes.queries).toHaveLength(1);
    });

    it('shows the error state with Retry when the read fails, and reads again on Retry', async () => {
      const lab = serveLab({ remotes: [mirror()] });
      server.use(
        http.get(`*${lab.remotes.path}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const { user } = renderDetail();

      expect(
        await screen.findByText('Remote could not be displayed.'),
      ).toBeVisible();
      server.use(lab.remotes.handler);
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Remote name')).toBeVisible();
    });

    it("shows the insufficient permissions page with Pulp's reason when the read is refused", async () => {
      serveLab({ remotes: [] });
      server.use(
        http.get(`*${API}/remotes/file/file/`, () =>
          HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
        ),
      );

      renderDetail();

      expect(await screen.findByText('Not for you.')).toBeVisible();
    });

    it('offers the Details tab', async () => {
      serveLab({ remotes: [mirror()] });

      renderDetail();

      await detailRows();
      const details = screen.getByRole('link', { name: 'Details' });
      expect(details).toHaveAttribute('href', '/file/remotes/mirror/');
      expect(details).toHaveAttribute('aria-current', 'page');
    });
  },
);

describe(
  'Integration: the actions of the remote detail',
  { tags: ['integration'] },
  () => {
    const CHANGE = 'file.change_fileremote';
    const DELETE = 'file.delete_fileremote';

    const holding = (...permissions: string[]) =>
      serveAccount({ isStaff: false, own: [permissions] });

    it('offers Edit, which leads to the edit address, and Delete to a user who holds the change and delete permissions', async () => {
      holding(CHANGE, DELETE);
      serveLab({ remotes: [mirror()] });

      const { user } = renderDetail();
      await detailRows();

      expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible();
      await user.click(screen.getByRole('button', { name: 'Edit' }));
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/remotes/mirror/edit/',
      );
    });

    it('offers neither to a user who holds neither permission', async () => {
      holding();
      serveLab({ remotes: [mirror()] });
      renderDetail();
      await detailRows();

      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull(),
      );
      expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit labels' })).toBeNull();
    });

    it('lets a user who may change the remote add a label with one request', async () => {
      holding(CHANGE);
      const remote = mirror({ pulp_labels: { team: 'docs' } });
      serveLab({ remotes: [remote] });
      const sent: { path: string; body: unknown }[] = [];
      server.use(
        http.post(
          `*${API}/remotes/file/file/:id/set_label/`,
          async ({ request }) => {
            const body = await request.json();
            sent.push({ path: new URL(request.url).pathname, body });
            return HttpResponse.json(body);
          },
        ),
      );

      const { user } = renderDetail();
      await detailRows();
      await user.click(
        await screen.findByRole('button', { name: 'Edit labels' }),
      );
      await user.type(screen.getByLabelText('Label key'), 'tier');
      await user.type(screen.getByLabelText('Label value'), 'gold');
      await user.click(screen.getByRole('button', { name: 'Add label' }));

      await waitFor(() => expect(sent).toHaveLength(1));
      expect(sent[0]).toEqual({
        path: `${remote.pulp_href}set_label/`,
        body: { key: 'tier', value: 'gold' },
      });
    });
  },
);

describe(
  'Integration: the delete dialog of the remote detail',
  { tags: ['integration'] },
  () => {
    const DELETE = 'file.delete_fileremote';
    const deleteHolder = () =>
      serveAccount({ isStaff: false, own: [[DELETE]] });

    async function openDelete(user: ReturnType<typeof renderDetail>['user']) {
      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      return screen.findByRole('dialog');
    }

    it('names the remote and the repositories that use it, which are kept', async () => {
      deleteHolder();
      const remote = mirror();
      serveLab({
        remotes: [remote],
        repositories: ['docs', 'tools'].map((name) =>
          pluginRepository('file', { name, remote: remote.pulp_href }),
        ),
      });

      const { user } = renderDetail();
      await detailRows();
      const dialog = await openDelete(user);

      expect(within(dialog).getByText('Delete remote?')).toBeVisible();
      expect(within(dialog).getByText('mirror')).toBeVisible();
      expect(await within(dialog).findByText('docs')).toBeVisible();
      expect(within(dialog).getByText('tools')).toBeVisible();
      expect(within(dialog).getByText(/use this remote/i)).toBeVisible();
    });

    it('says no repository uses the remote when none does', async () => {
      deleteHolder();
      serveLab({ remotes: [mirror()] });

      const { user } = renderDetail();
      await detailRows();
      const dialog = await openDelete(user);

      expect(
        await within(dialog).findByText('No repository uses this remote.'),
      ).toBeVisible();
    });

    it('does not offer the delete before the repositories are known, and offers Retry when they could not be read', async () => {
      deleteHolder();
      const lab = serveLab({ remotes: [mirror()] });
      server.use(
        http.get(`*${lab.repositories.path}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      const { user } = renderDetail();
      await detailRows();
      const dialog = await openDelete(user);

      expect(
        await within(dialog).findByText(
          'The repositories that use this remote could not be listed, so nothing can be deleted.',
        ),
      ).toBeVisible();
      expect(
        within(dialog).getByRole('button', { name: 'Delete' }),
      ).toBeDisabled();

      server.use(lab.repositories.handler);
      await user.click(within(dialog).getByRole('button', { name: 'Retry' }));
      await waitFor(() =>
        expect(
          within(dialog).getByRole('button', { name: 'Delete' }),
        ).toBeEnabled(),
      );
    });

    it('sends nothing when the dialog is cancelled', async () => {
      deleteHolder();
      serveLab({ remotes: [mirror()] });
      const deletes: string[] = [];
      server.use(
        http.delete(`*${API}/remotes/file/file/:id/`, ({ request }) => {
          deletes.push(request.url);
          return HttpResponse.json({}, { status: 202 });
        }),
      );

      const { user } = renderDetail();
      await detailRows();
      const dialog = await openDelete(user);
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(deletes).toEqual([]);
    });

    it('shows the three-part refusal in the dialog, which stays open', async () => {
      deleteHolder();
      serveLab({ remotes: [mirror()] });
      server.use(
        http.delete(`*${API}/remotes/file/file/:id/`, () =>
          HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
        ),
      );

      const { user } = renderDetail();
      await detailRows();
      const dialog = await openDelete(user);
      await within(dialog).findByText('No repository uses this remote.');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(
        await within(dialog).findByText('Failed to delete remote "mirror"'),
      ).toBeVisible();
      expect(
        within(dialog).getByText('You do not have permission to do this.'),
      ).toBeVisible();
      expect(within(dialog).getByText('Not for you.')).toBeVisible();
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(
        within(dialog).getByRole('button', { name: 'Delete' }),
      ).toBeEnabled();
    });
  },
);
