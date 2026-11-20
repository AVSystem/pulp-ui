import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
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
  publicationListHandler,
  role,
  roleAssignment,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;
const REPOSITORY_PATH = `${API}/repositories/file/file/`;
const CHANGE = 'file.change_filerepository';

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

type Repository = ReturnType<typeof pluginRepository>;
type Remote = ReturnType<typeof pluginRemote>;

const existing = (overrides: Partial<Repository> = {}) =>
  pluginRepository('file', {
    name: 'existing',
    description: 'old text',
    retain_repo_versions: 3,
    autopublish: false,
    sha256sums: 'disabled',
    pulp_labels: { team: 'a', tier: 'b' },
    remote: null,
    ...overrides,
  });

// Every list the edit page and the detail page it returns to read, answered the
// way the server answers it, and the PATCH of the repository.
function serveLab({
  repositories,
  remotes = [],
  patch,
}: {
  repositories: Repository[];
  remotes?: Remote[];
  patch?: () => Response | Promise<Response>;
}) {
  const remoteLists = pluginListHandler('file', 'remote', remotes);
  server.use(
    pluginListHandler('file', 'repository', repositories).handler,
    remoteLists.handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    listOf(`${API}/remotes/`, remotes, {
      pageSize: 1000,
      matching: (row, query) => {
        const hrefs = inSetOf(query, 'pulp_href__in');
        return hrefs === null || hrefs.includes(row.pulp_href);
      },
      projected: projectedBy,
    }).handler,
    http.patch(`*${REPOSITORY_PATH}:id/`, async ({ request }) => {
      patched.push((await request.json()) as Record<string, unknown>);
      return (
        (await patch?.()) ??
        HttpResponse.json({ task: TASK_HREF }, { status: 202 })
      );
    }),
  );
  return { remoteQueries: remoteLists.queries };
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

function renderEdit(route = '/file/repositories/existing/edit') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const description = () => screen.getByRole('textbox', { name: /Description/ });
const retained = () => screen.getByRole('spinbutton', { name: /Retained/ });
const save = () => screen.getByRole('button', { name: 'Save' });
const formReady = () => screen.findByDisplayValue('existing');

beforeEach(() => {
  serveAccount({ isStaff: true });
});

describe(
  'Integration: the repository edit form built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('fills the fields of the file descriptor from the repository and keeps the name read-only', async () => {
      const mirror = pluginRemote('file', { name: 'mirror' });
      serveLab({
        repositories: [
          existing({ remote: mirror.pulp_href, autopublish: true }),
        ],
        remotes: [mirror],
      });

      renderEdit();

      const name = await formReady();
      expect(name).toBeDisabled();
      expect(description()).toHaveValue('old text');
      expect(retained()).toHaveValue(3);
      expect(
        screen.getByRole('checkbox', { name: /Publish new versions/ }),
      ).toBeChecked();
      expect(screen.getByRole('combobox', { name: /SHA256SUMS/ })).toHaveValue(
        'disabled',
      );
      expect(screen.getByDisplayValue('team')).toBeInTheDocument();
      expect(screen.getByDisplayValue('b')).toBeInTheDocument();
      expect(await screen.findByDisplayValue('mirror')).toBeInTheDocument();
      expect(save()).toBeEnabled();
    });

    it('sends one PATCH with only the changed field and returns to the detail address with the task alert', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(description());
      await user.type(description(), 'new text');
      await user.click(save());

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/file\/repositories\/existing\/?$/,
        ),
      );
      expect(patches()).toStrictEqual([
        { method: 'PATCH', path: expect.stringContaining(REPOSITORY_PATH) },
      ]);
      expect(writes()).toHaveLength(1);
      expect(patched).toStrictEqual([{ description: 'new text' }]);
      expect(
        await screen.findByText(/Update started for repository existing/),
      ).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /detail page/ })).toHaveAttribute(
        'href',
        expect.stringContaining('0000000000cc'),
      );
    });

    it('sends null for a description the user emptied', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(description());
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([{ description: null }]);
    });

    it('sends no request and says nothing changed when Save is pressed without a change', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.click(save());

      expect(
        await screen.findByText(/Nothing changed in repository existing/),
      ).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/file\/repositories\/existing\/?$/,
      );
      expect(writes()).toStrictEqual([]);
    });

    it('sends no request when a typed value equals the stored one', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.clear(retained());
      await user.type(retained(), '3');
      await user.click(save());

      expect(
        await screen.findByText(/Nothing changed in repository existing/),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('shows a plain success alert when the update is answered with the repository itself', async () => {
      const repository = existing();
      serveLab({
        repositories: [repository],
        patch: () => HttpResponse.json(repository, { status: 200 }),
      });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
      await user.click(save());

      expect(
        await screen.findByText(/Updated repository existing/),
      ).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: /detail page/ })).toBeNull();
    });

    it('sends a number for the retained versions, and null when the field is left blank', async () => {
      serveLab({ repositories: [existing()] });
      const first = renderEdit();

      await formReady();
      await first.user.clear(retained());
      await first.user.type(retained(), '5');
      await first.user.click(save());
      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ retain_repo_versions: 5 });
      first.unmount();

      const second = renderEdit();
      await formReady();
      await second.user.clear(retained());
      await second.user.click(save());
      await waitFor(() => expect(patched).toHaveLength(2));
      expect(patched[1]).toStrictEqual({ retain_repo_versions: null });
    });

    it('keeps a typed 0 in the retained versions field and sends it, leaving the refusal to the server', async () => {
      serveLab({
        repositories: [existing()],
        patch: () =>
          HttpResponse.json(
            {
              retain_repo_versions: [
                'Ensure this value is greater than or equal to 1.',
              ],
            },
            { status: 400 },
          ),
      });
      const { user } = renderEdit();

      await formReady();
      await user.clear(retained());
      await user.type(retained(), '0');
      expect(retained()).toHaveValue(0);
      await user.click(save());

      expect(
        await screen.findByText(
          'Ensure this value is greater than or equal to 1.',
        ),
      ).toBeInTheDocument();
      expect(patched).toStrictEqual([{ retain_repo_versions: 0 }]);
      expect(screen.getByTestId('location')).toHaveTextContent(/edit/);
      await waitFor(() => expect(save()).toBeEnabled());
    });

    it('sends the plugin options only when they changed: the autopublish box and the SHA256SUMS choice', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.click(
        screen.getByRole('checkbox', { name: /Publish new versions/ }),
      );
      await user.selectOptions(
        screen.getByRole('combobox', { name: /SHA256SUMS/ }),
        'root',
      );
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([
        { autopublish: true, sha256sums: 'root' },
      ]);
    });

    it('offers every SHA256SUMS choice the server knows', async () => {
      serveLab({ repositories: [existing()] });
      renderEdit();

      await formReady();
      const choices = within(
        screen.getByRole('combobox', { name: /SHA256SUMS/ }),
      ).getAllByRole('option');
      expect(choices.map((option) => option.getAttribute('value'))).toEqual([
        'disabled',
        'root',
        'directory',
      ]);
    });

    it('sends the labels as they stand after one is added and one is removed', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.click(
        screen.getAllByRole('button', { name: /Remove label/ })[1],
      );
      await user.click(screen.getByRole('button', { name: /Add label/ }));
      const keys = screen.getAllByRole('textbox', { name: 'Label key' });
      const values = screen.getAllByRole('textbox', { name: 'Label value' });
      await user.type(keys[1], 'env');
      await user.type(values[1], 'prod');
      await user.click(save());

      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched).toStrictEqual([
        { pulp_labels: { team: 'a', env: 'prod' } },
      ]);
    });

    it('refuses a label the server would refuse, with a reason, and sends nothing', async () => {
      serveLab({ repositories: [existing({ pulp_labels: {} })] });
      const { user } = renderEdit();

      await formReady();
      await user.click(screen.getByRole('button', { name: /Add label/ }));
      await user.type(
        screen.getByRole('textbox', { name: 'Label key' }),
        'bad/key',
      );

      expect(
        await screen.findByText(/A label key can contain only/),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
      expect(writes()).toStrictEqual([]);
    });

    it('sends the address of a remote chosen from the list and null when the choice is cleared', async () => {
      const mirror = pluginRemote('file', { name: 'mirror' });
      const other = pluginRemote('file', { name: 'other' });
      serveLab({
        repositories: [existing({ remote: mirror.pulp_href })],
        remotes: [mirror, other],
      });
      const first = renderEdit();

      await first.user.click(
        await screen.findByRole('combobox', { name: 'Select a remote' }),
      );
      await first.user.click(
        await screen.findByRole('option', { name: 'other' }),
      );
      await first.user.click(save());
      await waitFor(() => expect(patched).toHaveLength(1));
      expect(patched[0]).toStrictEqual({ remote: other.pulp_href });
      first.unmount();

      const second = renderEdit();
      await screen.findByDisplayValue('mirror');
      await second.user.click(screen.getByRole('button', { name: 'Clear' }));
      await second.user.click(save());
      await waitFor(() => expect(patched).toHaveLength(2));
      expect(patched[1]).toStrictEqual({ remote: null });
    });

    it('searches the remotes by the text typed and keeps the name of the selected remote while others are listed', async () => {
      const mirror = pluginRemote('file', { name: 'mirror' });
      const other = pluginRemote('file', { name: 'other' });
      const { remoteQueries } = serveLab({
        repositories: [existing({ remote: mirror.pulp_href })],
        remotes: [mirror, other],
      });
      const { user } = renderEdit();

      const field = await screen.findByRole('combobox', {
        name: 'Select a remote',
      });
      await screen.findByDisplayValue('mirror');
      await user.clear(field);
      await user.type(field, 'oth');

      await waitFor(() =>
        expect(
          remoteQueries.some((query) => query.get('name__icontains') === 'oth'),
        ).toBe(true),
      );
      expect(
        await screen.findByRole('option', { name: 'other' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'mirror' })).toBeNull();
    });

    it('says the remotes could not be loaded and keeps the rest of the form usable', async () => {
      serveLab({ repositories: [existing()] });
      server.use(
        http.get(`*${API}/remotes/file/file/`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );
      const { user } = renderEdit();

      expect(
        await screen.findByText(/Failed to load remotes/),
      ).toBeInTheDocument();
      await user.type(description(), '!');
      expect(save()).toBeEnabled();
    });

    it('shows the server message under the field it belongs to and stays on the form', async () => {
      serveLab({
        repositories: [existing()],
        patch: () =>
          HttpResponse.json(
            {
              description: [
                'Ensure this field has no more than 255 characters.',
              ],
            },
            { status: 400 },
          ),
      });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
      await user.click(save());

      const message = await screen.findByText(
        'Ensure this field has no more than 255 characters.',
      );
      expect(message).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(/edit/);
      expect(description()).toHaveValue('old text!');
      await waitFor(() => expect(save()).toBeEnabled());
    });

    it('shows a refusal as an alert with its three parts, the reason of Pulp in the middle, and keeps what was typed', async () => {
      serveLab({
        repositories: [existing()],
        patch: () =>
          HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
      });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
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
      expect(description()).toHaveValue('old text!');
    });

    it('shows an error that belongs to no field in the same alert', async () => {
      serveLab({
        repositories: [existing()],
        patch: () =>
          HttpResponse.json(
            { non_field_errors: ['These options cannot be combined.'] },
            { status: 400 },
          ),
      });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
      await user.click(save());

      const message = await screen.findByText(
        /These options cannot be combined\./,
      );
      expect(message.closest('.pf-v6-c-alert')).not.toBeNull();
    });

    it('sends one PATCH for a double click on Save and keeps Save off while it is pending', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      serveLab({
        repositories: [existing()],
        patch: async () => {
          await gate;
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
      await user.dblClick(save());

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /^Save/ })).toBeDisabled(),
      );
      expect(patches()).toHaveLength(1);
      release();
      await waitFor(() =>
        expect(screen.getByTestId('location')).not.toHaveTextContent(/edit/),
      );
      expect(patches()).toHaveLength(1);
    });

    it('shows Not Found for a repository no read finds and reads nothing else', async () => {
      serveLab({ repositories: [] });

      renderEdit('/file/repositories/ghost/edit');

      expect(
        await screen.findByRole('heading', { name: /not found/i }),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('goes back to the detail address on Cancel without a request', async () => {
      serveLab({ repositories: [existing()] });
      const { user } = renderEdit();

      await formReady();
      await user.type(description(), '!');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).not.toHaveTextContent(/edit/),
      );
      expect(writes()).toStrictEqual([]);
    });
  },
);

describe(
  'Integration: the repository edit form after the same user signs in again',
  { tags: ['integration'] },
  () => {
    function renderAfterSignIn() {
      serveSignIn();
      return renderWithProviders(
        <>
          <SignInAgain />
          <AppContextProvider>
            <Routed />
          </AppContextProvider>
        </>,
        { route: '/file/repositories/existing/edit' },
      );
    }

    const serveRows = (row: Repository) =>
      server.use(pluginListHandler('file', 'repository', [row]).handler);

    const reads = () =>
      seen.filter((r) => r.method === 'GET' && r.path === REPOSITORY_PATH)
        .length;

    it('reads the repository again, keeps the description the user typed and sends no write', async () => {
      const repository = existing();
      serveLab({ repositories: [repository] });
      const { user } = renderAfterSignIn();
      await formReady();
      await signedIn();
      await user.clear(description());
      await user.type(description(), 'typed text');
      expect(reads()).toBe(1);
      serveRows({ ...repository, description: 'server text' });

      await user.click(screen.getByRole('button', { name: 'Sign in again' }));

      await waitFor(() => expect(reads()).toBe(2));
      await waitFor(() =>
        expect(screen.getByTestId('session')).toHaveTextContent(
          'authenticated',
        ),
      );
      expect(description()).toHaveValue('typed text');
      expect(patches()).toStrictEqual([]);
    });

    it('shows the fresh description in a form the user has not changed', async () => {
      const repository = existing();
      serveLab({ repositories: [repository] });
      const { user } = renderAfterSignIn();
      await formReady();
      await signedIn();
      expect(description()).toHaveValue('old text');
      serveRows({ ...repository, description: 'server text' });

      await user.click(screen.getByRole('button', { name: 'Sign in again' }));

      await waitFor(() => expect(description()).toHaveValue('server text'));
      expect(patches()).toStrictEqual([]);
    });

    it('keeps the typed values and shows no message when the save ends with the session', async () => {
      serveLab({
        repositories: [existing()],
        patch: () => HttpResponse.json({ detail: 'expired' }, { status: 401 }),
      });
      const { user } = renderAfterSignIn();
      await formReady();
      await signedIn();
      await user.type(description(), '!');

      await user.click(save());

      await waitFor(() => expect(patches()).toHaveLength(1));
      expect(description()).toHaveValue('old text!');
      expect(screen.queryByText(/expired/)).toBeNull();
      expect(
        screen.queryByText('You do not have permission to do this.'),
      ).toBeNull();
    });
  },
);

describe(
  'Integration: who sees the repository edit form',
  { tags: ['integration'] },
  () => {
    const refusal = () =>
      screen.findByRole('heading', { name: 'Insufficient permissions' });
    const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

    function renderAs(route = '/file/repositories/existing/edit') {
      return renderWithProviders(
        <AppContextProvider>
          <Routed />
        </AppContextProvider>,
        { route, signedIn: true },
      );
    }

    // The roles a user holds on single objects, as the index of the user's role
    // assignments lists them, and what each role allows.
    function serveObjectRole(repository: Repository, permissions: string[]) {
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
          HttpResponse.json(page([role({ name: 'owner', permissions })])),
        ),
      );
    }

    it('shows the insufficient permissions page, with no Save button and no write, to an account without the change permission', async () => {
      const repository = existing();
      serveAccount({ isStaff: false, own: [['file.view_filerepository']] });
      serveLab({ repositories: [repository] });
      serveObjectRole(repository, ['file.view_filerepository']);

      renderAs();

      await refusal();
      expect(
        screen.getByRole('heading', { name: 'existing' }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(screen.queryByDisplayValue('existing')).toBeNull();
      await settled();
      expect(writes()).toStrictEqual([]);
    });

    it('shows the form to an account that holds the change permission on every repository', async () => {
      serveAccount({ isStaff: false, own: [[CHANGE]] });
      serveLab({ repositories: [existing()] });

      renderAs();

      expect(await formReady()).toBeInTheDocument();
      expect(save()).toBeInTheDocument();
    });

    it('shows the form to an account that holds the change role on this repository only', async () => {
      const repository = existing();
      serveAccount({ isStaff: false });
      serveLab({ repositories: [repository] });
      serveObjectRole(repository, [CHANGE]);

      renderAs();

      expect(await formReady()).toBeInTheDocument();
    });

    it('shows the form to staff without reading the roles on single objects', async () => {
      const served = serveAccount({ isStaff: true });
      serveLab({ repositories: [existing()] });

      renderAs();

      expect(await formReady()).toBeInTheDocument();
      await settled();
      expect(served.requests.some((path) => /\/roles\//.test(path))).toBe(
        false,
      );
    });

    it('shows the loading state and no form and no refusal while the permissions are read', async () => {
      serveAccount({ isStaff: false });
      serveLab({ repositories: [existing()] });
      server.use(
        http.get(`*${API}/users/7/`, () => new Promise(() => undefined)),
      );

      renderAs();

      await screen.findByRole('progressbar');
      await settled();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
      expect(
        screen.queryByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeNull();
    });

    it('shows a failed permission read with Retry, never as a refusal and never as a spinner, and shows the form once the read succeeds', async () => {
      serveAccount({ isStaff: true });
      serveLab({ repositories: [existing()] });
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
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(
        screen.queryByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeNull();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await formReady()).toBeInTheDocument();
    });

    it('shows a failed read of the roles on single objects with Retry instead of a refusal', async () => {
      const repository = existing();
      serveAccount({ isStaff: false });
      serveLab({ repositories: [repository] });
      let failing = true;
      serveObjectRole(repository, [CHANGE]);
      const answer = (row: unknown) => row;
      server.use(
        http.get(`*${API}/roles/`, () =>
          failing
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(
                answer(page([role({ name: 'owner', permissions: [CHANGE] })])),
              ),
        ),
      );
      const { user } = renderAs();

      expect(
        await screen.findByText('Your permissions could not be read'),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeNull();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await formReady()).toBeInTheDocument();
    });

    it('shows the insufficient permissions page when Pulp refuses the read of the repository, with its reason', async () => {
      serveAccount({ isStaff: true });
      serveLab({ repositories: [existing()] });
      server.use(
        http.get(`*${REPOSITORY_PATH}`, () =>
          HttpResponse.json({ detail: 'Hidden from you.' }, { status: 403 }),
        ),
      );

      renderAs();

      await refusal();
      expect(screen.getByText('Hidden from you.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    });

    it('shows a failed read of the repository with Retry', async () => {
      serveAccount({ isStaff: true });
      serveLab({ repositories: [existing()] });
      server.use(
        http.get(`*${REPOSITORY_PATH}`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );

      renderAs();

      expect(
        await screen.findByText('Repository could not be displayed.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    });
  },
);
