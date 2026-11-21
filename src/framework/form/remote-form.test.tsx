import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRemote,
  inSetOf,
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  projectedBy,
  role,
  roleAssignment,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;
const REMOTE_PATH = `${API}/remotes/file/file/`;
const CHANGE = 'file.change_fileremote';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

interface Seen {
  method: string;
  path: string;
}

let seen: Seen[];
let patched: Record<string, unknown>[];
let permissionServers: { stop: () => void }[];

const writes = () => seen.filter((r) => r.method !== 'GET');
const patches = () => writes().filter((r) => r.method === 'PATCH');

beforeEach(() => {
  seen = [];
  patched = [];
  permissionServers = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
  });
});

afterEach(() => {
  server.events.removeAllListeners();
  for (const served of permissionServers) {
    served.stop();
  }
});

function serveAccount(setup: Parameters<typeof servePermissions>[0]) {
  const served = servePermissions({ id: 7, ...setup });
  permissionServers.push(served);
  return served;
}

// The secret fields of a file remote as the server lists them, with the named
// ones holding a value.
const hiddenFields = (stored: string[] = []) =>
  [
    'client_key',
    'proxy_username',
    'proxy_password',
    'username',
    'password',
  ].map((name) => ({ name, is_set: stored.includes(name) }));

const existing = (overrides: Partial<IRemote> = {}) =>
  pluginRemote('file', {
    name: 'tools',
    url: 'https://pulp.example/files/',
    policy: 'immediate',
    hidden_fields: hiddenFields(),
    ...overrides,
  });

// Every list the edit page and the detail page it returns to read, answered the
// way the server answers it, and the PATCH of the remote.
function serveLab({
  remotes,
  patch,
}: {
  remotes: IRemote[];
  patch?: () => Response | Promise<Response>;
}) {
  server.use(
    pluginListHandler('file', 'remote', remotes).handler,
    pluginListHandler('file', 'repository', []).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    http.patch(`*${REMOTE_PATH}:id/`, async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return (
        (await patch?.()) ??
        HttpResponse.json({ task: TASK_HREF }, { status: 202 })
      );
    }),
  );
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

function renderEdit(route = '/file/remotes/tools/edit') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const nameInput = () => screen.getByRole('textbox', { name: 'Name' });
const urlInput = () => screen.getByRole('textbox', { name: /^URL/ });
const policy = () => screen.getByRole('combobox', { name: /Download policy/ });
const save = () => screen.getByRole('button', { name: 'Save' });
const formReady = () => screen.findByDisplayValue('tools');

// The advanced options sit behind a toggle.
async function showAdvanced(user: { click: (element: Element) => unknown }) {
  await user.click(
    await screen.findByRole('button', { name: /Show advanced options/ }),
  );
}

const concurrency = () =>
  screen.getByRole('spinbutton', { name: /Download concurrency/ });
const timeout = () => screen.getByRole('spinbutton', { name: /Total timeout/ });
const retries = () => screen.getByRole('spinbutton', { name: /Retries/ });

beforeEach(() => {
  serveAccount({ isStaff: true });
});

describe(
  'Integration: the remote edit form built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('fills the fields of the remote, keeps the name read-only and offers the three download policies with their explanation', async () => {
      serveLab({
        remotes: [
          existing({
            proxy_url: 'http://proxy.example:3128',
            tls_validation: false,
            download_concurrency: 5,
            rate_limit: 20,
          }),
        ],
      });
      const { user } = renderEdit();

      await formReady();
      expect(nameInput()).toBeDisabled();
      expect(urlInput()).toHaveValue('https://pulp.example/files/');
      const options = within(policy())
        .getAllByRole('option')
        .map((option) => (option as HTMLOptionElement).value);
      expect(options).toEqual(['immediate', 'on_demand', 'streamed']);
      expect(policy()).toHaveValue('immediate');
      expect(
        screen.getByText(/On demand fetches content when a client asks for it/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('textbox', { name: 'Proxy URL' }),
      ).not.toBeInTheDocument();

      await showAdvanced(user);
      expect(screen.getByRole('textbox', { name: 'Proxy URL' })).toHaveValue(
        'http://proxy.example:3128',
      );
      expect(
        screen.getByRole('checkbox', { name: /Validate the TLS certificate/ }),
      ).not.toBeChecked();
      expect(concurrency()).toHaveValue(5);
      expect(
        screen.getByRole('spinbutton', { name: /Rate limit/ }),
      ).toHaveValue(20);
      expect(save()).toBeEnabled();
    });

    it('sends one PATCH with only the changed URL, with the trailing slash the server asks for, and returns to the remote with the task alert', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(urlInput());
      await user.type(urlInput(), 'https://pulp.example/other');
      await user.click(save());

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/file\/remotes\/tools\/?$/,
        ),
      );
      expect(patches()).toStrictEqual([
        { method: 'PATCH', path: expect.stringContaining(REMOTE_PATH) },
      ]);
      expect(writes()).toHaveLength(1);
      expect(patched).toStrictEqual([{ url: 'https://pulp.example/other/' }]);
      expect(
        await screen.findByText(/Update started for remote tools/),
      ).toBeInTheDocument();
    });

    it('leaves an address with a query as it was typed', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(urlInput());
      await user.type(urlInput(), 'https://pulp.example/files?token=1');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([
        { url: 'https://pulp.example/files?token=1' },
      ]);
    });

    it('sends the policy the user picks and nothing else', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.selectOptions(policy(), 'streamed');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ policy: 'streamed' }]);
    });

    it('sends no request and says nothing changed when Save is pressed without a change', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.click(save());

      expect(
        await screen.findByText(/Nothing changed in remote tools/),
      ).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/file\/remotes\/tools\/?$/,
      );
      expect(writes()).toStrictEqual([]);
    });

    it('sends null for a value the user emptied', async () => {
      serveLab({ remotes: [existing({ proxy_url: 'http://proxy.example' })] });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      await user.clear(screen.getByRole('textbox', { name: 'Proxy URL' }));
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ proxy_url: null }]);
    });

    it('shows a stored password as set with Clear and sends nothing about it when another field is changed', async () => {
      serveLab({
        remotes: [existing({ hidden_fields: hiddenFields(['password']) })],
      });
      const { user } = renderEdit();

      await formReady();
      const password = screen.getByRole('textbox', { name: 'Password' });
      expect(password).toHaveValue('Is set');
      expect(password).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Clear Password' }),
      ).toBeEnabled();
      // the username is not stored, so it is an input
      expect(screen.getByRole('textbox', { name: /^Username/ })).toHaveValue(
        '',
      );

      await user.selectOptions(policy(), 'streamed');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ policy: 'streamed' }]);
    });

    it('sends null for a secret only after Clear was pressed', async () => {
      serveLab({
        remotes: [existing({ hidden_fields: hiddenFields(['password']) })],
      });
      const { user } = renderEdit();

      await formReady();
      await user.click(screen.getByRole('button', { name: 'Clear Password' }));
      expect(
        screen.getByText(/The stored value is removed when you save/),
      ).toBeInTheDocument();
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ password: null }]);
    });

    it('sends a new secret after Clear, and never keeps it anywhere but in the form', async () => {
      serveLab({
        remotes: [existing({ hidden_fields: hiddenFields(['password']) })],
      });
      const { user } = renderEdit();

      await formReady();
      await user.click(screen.getByRole('button', { name: 'Clear Password' }));
      const input = screen.getByLabelText(/^Password/, { selector: 'input' });
      expect(input).toHaveAttribute('type', 'password');
      await user.type(input, 'hunter2-new');
      expect(
        screen.getByText(/The stored value is replaced when you save/),
      ).toBeInTheDocument();
      expect(JSON.stringify({ ...window.localStorage })).not.toContain(
        'hunter2-new',
      );
      expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(
        'hunter2-new',
      );
      expect(window.location.href).not.toContain('hunter2-new');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ password: 'hunter2-new' }]);
    });

    it('keeps the stored secret when the user takes the Clear back', async () => {
      serveLab({
        remotes: [existing({ hidden_fields: hiddenFields(['password']) })],
      });
      const { user } = renderEdit();

      await formReady();
      await user.click(screen.getByRole('button', { name: 'Clear Password' }));
      await user.click(
        screen.getByRole('button', { name: 'Keep the stored Password' }),
      );
      expect(screen.getByRole('textbox', { name: 'Password' })).toHaveValue(
        'Is set',
      );
      await user.click(save());

      expect(
        await screen.findByText(/Nothing changed in remote tools/),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('sends a decimal total timeout as typed and retries as a whole number', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      await user.type(timeout(), '2.5');
      await user.type(retries(), '3');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ total_timeout: 2.5, max_retries: 3 }]);
    });

    it('sends null for a total timeout and retries that were emptied so the server default applies', async () => {
      serveLab({ remotes: [existing({ total_timeout: 30, max_retries: 5 })] });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      expect(timeout()).toHaveValue(30);
      expect(retries()).toHaveValue(5);
      await user.clear(timeout());
      await user.clear(retries());
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([
        { total_timeout: null, max_retries: null },
      ]);
    });

    it('sends nothing for stored values the user does not touch, a zero included', async () => {
      serveLab({ remotes: [existing({ total_timeout: 0.5, max_retries: 0 })] });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      expect(timeout()).toHaveValue(0.5);
      expect(retries()).toHaveValue(0);
      await user.click(save());

      expect(
        await screen.findByText(/Nothing changed in remote tools/),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('shows the default of the download concurrency, and keeps Save off for a value the server would refuse', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      expect(concurrency()).toHaveValue(null);
      expect(concurrency()).toHaveAttribute('placeholder', '10');
      expect(
        screen.getByText(/Leave empty to use the default of 10 connections/),
      ).toBeInTheDocument();

      await user.type(concurrency(), '0');
      expect(screen.getByText('Enter 1 or more.')).toBeInTheDocument();
      expect(save()).toBeDisabled();
      await user.clear(concurrency());
      await user.type(concurrency(), '4');
      expect(save()).toBeEnabled();
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ download_concurrency: 4 }]);
    });

    it('keeps Save off for an address that is not http or https', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(urlInput());
      await user.type(urlInput(), 'ftp://pulp.example/files/');

      expect(
        screen.getByText("The URL needs to be in 'http(s)://' format."),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('shows the server message under the field it belongs to, opens the advanced options for a field in them, and stays on the form', async () => {
      serveLab({
        remotes: [existing()],
        patch: () =>
          HttpResponse.json(
            { proxy_url: ['Enter a valid URL.'] },
            { status: 400 },
          ),
      });
      const { user } = renderEdit();

      await formReady();
      await showAdvanced(user);
      await user.type(
        screen.getByRole('textbox', { name: 'Proxy URL' }),
        'nonsense',
      );
      await user.click(save());

      expect(await screen.findByText('Enter a valid URL.')).toBeVisible();
      expect(screen.getByTestId('location')).toHaveTextContent(/edit/);
      expect(screen.getByRole('textbox', { name: 'Proxy URL' })).toHaveValue(
        'nonsense',
      );
      await waitFor(() => expect(save()).toBeEnabled());
    });

    it('shows a refusal as an alert with its three parts, the reason of Pulp in the middle, and keeps what was typed', async () => {
      serveLab({
        remotes: [existing()],
        patch: () =>
          HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
      });
      const { user } = renderEdit();

      await formReady();
      await user.selectOptions(policy(), 'streamed');
      await user.click(save());

      const reason = await screen.findByText('Not allowed here.');
      const alert = reason.closest('.pf-v6-c-alert') as HTMLElement;
      expect(alert).not.toBeNull();
      const parts = Array.from(alert.querySelectorAll('p')).map(
        (part) => part.textContent,
      );
      expect(parts).toEqual([
        'You do not have permission to do this.',
        'Not allowed here.',
        'Contact your organization administrator for more information.',
      ]);
      expect(screen.getByTestId('location')).toHaveTextContent(/edit/);
      expect(policy()).toHaveValue('streamed');
    });

    it('shows a readable message and keeps the typed values when the request gets no answer', async () => {
      serveLab({ remotes: [existing()] });
      server.use(http.patch(`*${REMOTE_PATH}:id/`, () => HttpResponse.error()));
      const { user } = renderEdit();

      await formReady();
      await user.selectOptions(policy(), 'streamed');
      await user.click(save());

      const failed = await screen.findByText(
        /Remote "tools" could not be updated/,
      );
      expect(failed.closest('.pf-v6-c-alert')).not.toBeNull();
      expect(screen.getByTestId('location')).toHaveTextContent(/edit/);
      expect(policy()).toHaveValue('streamed');
      await waitFor(() => expect(save()).toBeEnabled());
    });

    it('sends one PATCH for a double click on Save and keeps Save off while it is pending', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      serveLab({
        remotes: [existing()],
        patch: async () => {
          await gate;
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      });
      const { user } = renderEdit();

      await formReady();
      await user.selectOptions(policy(), 'streamed');
      await user.dblClick(save());
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled(),
      );
      expect(patches()).toHaveLength(1);
      release();

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/file\/remotes\/tools\/?$/,
        ),
      );
      expect(patches()).toHaveLength(1);
    });

    it('shows Not Found for a remote no read finds and reads nothing else', async () => {
      serveLab({ remotes: [] });
      renderEdit('/file/remotes/ghost/edit');

      expect(
        await screen.findByRole('heading', { name: /Page not found/ }),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('goes back to the remote on Cancel without a request', async () => {
      serveLab({ remotes: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.selectOptions(policy(), 'streamed');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/file\/remotes\/tools\/?$/,
        ),
      );
      expect(writes()).toStrictEqual([]);
    });
  },
);

describe(
  'Integration: who sees the remote edit form',
  { tags: ['integration'] },
  () => {
    const refusal = () =>
      screen.findByRole('heading', { name: 'Insufficient permissions' });
    const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

    function renderAs(route = '/file/remotes/tools/edit') {
      return renderWithProviders(
        <AppContextProvider>
          <Routed />
        </AppContextProvider>,
        { route, signedIn: true },
      );
    }

    // The roles a user holds on single objects, as the index of the user's role
    // assignments lists them, and what each role allows.
    function serveObjectRole(remote: IRemote, permissions: string[]) {
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', remote.pulp_href)],
          {
            pageSize: 1000,
            matching: (row, query) =>
              query.get('content_object') !== 'null' ||
              row.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        listOf(`${API}/remotes/`, [remote], {
          pageSize: 1000,
          matching: (row, query) => {
            const hrefs = inSetOf(query, 'pulp_href__in');
            return hrefs === null || hrefs.includes(row.pulp_href);
          },
          projected: projectedBy,
        }).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(page([role({ name: 'owner', permissions })])),
        ),
      );
    }

    it('shows the insufficient permissions page, with no Save button and no write, to an account without the change permission', async () => {
      const remote = existing();
      serveAccount({ isStaff: false, own: [['file.view_fileremote']] });
      serveLab({ remotes: [remote] });
      serveObjectRole(remote, ['file.view_fileremote']);

      renderAs();

      await refusal();
      expect(
        screen.getByRole('heading', { name: 'tools' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.queryByDisplayValue('tools')).toBeNull();
      await settled();
      expect(writes()).toStrictEqual([]);
    });

    it('shows the form to an account that holds the change permission on every remote', async () => {
      serveAccount({ isStaff: false, own: [[CHANGE]] });
      serveLab({ remotes: [existing()] });

      renderAs();

      expect(await formReady()).toBeInTheDocument();
      expect(save()).toBeInTheDocument();
    });

    it('shows the form to an account that holds the change role on this remote only', async () => {
      const remote = existing();
      serveAccount({ isStaff: false });
      serveLab({ remotes: [remote] });
      serveObjectRole(remote, [CHANGE]);

      renderAs();

      expect(await formReady()).toBeInTheDocument();
    });

    it('shows a failed permission read with Retry, never as a refusal, and shows the form once the read succeeds', async () => {
      serveAccount({ isStaff: true });
      serveLab({ remotes: [existing()] });
      let failing = true;
      server.use(
        http.get(`*${API}/users/7/`, () =>
          failing
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json({
                username: 'zoe',
                pulp_href: `${API}/users/7/`,
                id: 7,
                is_staff: true,
                groups: [],
              }),
        ),
      );
      const { user } = renderAs();

      expect(
        await screen.findByText('Your permissions could not be read'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await formReady()).toBeInTheDocument();
    });

    it('shows the insufficient permissions page when Pulp refuses the read of the remote, with its reason', async () => {
      serveAccount({ isStaff: true });
      serveLab({ remotes: [existing()] });
      server.use(
        http.get(`*${REMOTE_PATH}`, () =>
          HttpResponse.json({ detail: 'Hidden from you.' }, { status: 403 }),
        ),
      );

      renderAs();

      await refusal();
      expect(screen.getByText('Hidden from you.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('shows a failed read of the remote with Retry', async () => {
      serveAccount({ isStaff: true });
      serveLab({ remotes: [existing()] });
      server.use(
        http.get(`*${REMOTE_PATH}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      renderAs();

      expect(
        await screen.findByText('Remote could not be displayed.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    });
  },
);
