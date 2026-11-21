import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useEffect } from 'react';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IDistribution,
  distribution,
  distributionListHandler,
  inSetOf,
  listOf,
  page,
  pluginListHandler,
  pluginRemote,
  pluginRepository,
  projectedBy,
  publicationListHandler,
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

// The configuration is loaded once when the application starts, so a test that
// needs a different one replaces the module. The reserved prefixes are a
// made-up list, not those of any deployment. null stands for the fallback the
// application installs when the configuration could not be loaded; undefined
// for a served configuration that does not mention the list at all.
const settings = vi.hoisted(() => ({
  reservedPrefixes: [] as string[] | null | undefined,
}));

vi.mock('src/ui-config', () => ({
  configPromise: Promise.resolve(),
  configFallback: () => undefined,
  get config() {
    return {
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
      ...(settings.reservedPrefixes === undefined
        ? {}
        : { RESERVED_BASE_PATH_PREFIXES: settings.reservedPrefixes }),
    };
  },
}));

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;
const REPOSITORY_PATH = `${API}/repositories/file/file/`;
const DISTRIBUTION_PATH = `${API}/distributions/file/file/`;

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
let posted: { path: string; body: Record<string, unknown> }[];
let permissionServers: { stop: () => void }[];

const writes = () => seen.filter((r) => r.method !== 'GET');
const bodiesOf = (path: string) =>
  posted.filter((p) => p.path === path).map((p) => p.body);

beforeEach(() => {
  seen = [];
  queuedTitles = [];
  posted = [];
  permissionServers = [];
  settings.reservedPrefixes = [];
  server.events.on('request:start', ({ request }) => {
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname,
    });
  });
  serveAccount({ isStaff: true });
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

interface Lab {
  // the distributions of every plugin the availability check finds
  distributions?: IDistribution[];
  remotes?: ReturnType<typeof pluginRemote>[];
  // the answer to the repository POST, instead of a created repository
  repositoryAnswer?: () => Response | Promise<Response>;
  distributionAnswer?: () => Response | Promise<Response>;
  taskState?: string;
  contentSettings?: Record<string, unknown> | null;
}

// Every list the create page and the detail page it returns to read, answered
// the way the server answers it, and the two POSTs. A repository that is
// created is listed from then on, as the server does.
function serveLab({
  distributions = [],
  remotes = [],
  repositoryAnswer,
  distributionAnswer,
  taskState = 'completed',
  contentSettings = {
    content_origin: 'https://pulp.example',
    content_path_prefix: '/pulp/content/',
  },
}: Lab = {}) {
  const repositories: Repository[] = [];
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
    listOf(`${API}/distributions/`, distributions, {
      matching: (row, query) => {
        if (query.has('name')) {
          return row.name === query.get('name');
        }
        if (query.has('base_path__in')) {
          return (query.get('base_path__in') as string)
            .split(',')
            .includes(row.base_path);
        }
        if (query.has('base_path__contains')) {
          return row.base_path.includes(query.get('base_path__contains') ?? '');
        }
        return true;
      },
      projected: projectedBy,
    }).handler,
    http.get(`*${API}/status/`, () =>
      HttpResponse.json({
        versions: [
          { component: 'core', version: '3.0.0' },
          { component: 'file', version: '3.0.0' },
        ],
        ...(contentSettings === null
          ? {}
          : { content_settings: contentSettings }),
      }),
    ),
    http.get('*/pulp/api/v3/tasks/:id/', () =>
      HttpResponse.json({
        pulp_href: TASK_HREF,
        name: 'create',
        state: taskState,
      }),
    ),
    http.post(`*${REPOSITORY_PATH}`, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      posted.push({ path: REPOSITORY_PATH, body });
      if (repositoryAnswer) {
        return repositoryAnswer();
      }
      const created = pluginRepository('file', {
        name: String(body['name']),
      });
      repositories.push(created);
      return HttpResponse.json(created, { status: 201 });
    }),
    http.post(`*${DISTRIBUTION_PATH}`, async ({ request }) => {
      posted.push({
        path: DISTRIBUTION_PATH,
        body: (await request.json()) as Record<string, unknown>,
      });
      return (
        distributionAnswer?.() ??
        HttpResponse.json({ task: TASK_HREF }, { status: 202 })
      );
    }),
  );
  return { repositories, remoteQueries: remoteLists.queries };
}

// The title of every alert that was queued for the next screen, in order, so a
// test can see an alert that is taken over at once or that no screen shows.
let queuedTitles: string[];

function Queued() {
  const { alerts } = useAppContext();

  useEffect(() => {
    for (const { title } of alerts) {
      if (typeof title === 'string' && !queuedTitles.includes(title)) {
        queuedTitles.push(title);
      }
    }
  }, [alerts]);

  return null;
}

function Routed() {
  const { pathname } = useLocation();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      <Queued />
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

function renderCreate(route = '/file/repository/new') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const nameInput = () => screen.getByRole('textbox', { name: /Name/ });
const retained = () => screen.getByRole('spinbutton', { name: /Retained/ });
const save = () => screen.getByRole('button', { name: /^Save/ });
const formReady = () => screen.findByRole('textbox', { name: /Name/ });
const distributionBox = () =>
  screen.queryByRole('checkbox', { name: /Create a distribution/ });
const basePathInput = () => screen.getByRole('textbox', { name: /Base path/ });
const atDetail = (name: string) =>
  waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^/file/repositories/${name}/?$`),
    ),
  );

describe(
  'Integration: the repository create form built from the descriptor',
  { tags: ['integration'] },
  () => {
    it('starts blank, marks Name required and keeps Save off until a name is typed', async () => {
      serveLab();
      const { user } = renderCreate();

      expect(await formReady()).toBeRequired();
      expect(nameInput()).toHaveValue('');
      expect(retained()).toHaveValue(null);
      expect(save()).toBeDisabled();

      await user.type(nameInput(), 'a');

      expect(save()).toBeEnabled();
    });

    it('offers the file options at the values the server starts from: autopublish off and SHA256SUMS disabled', async () => {
      serveLab();
      renderCreate();

      await formReady();

      expect(
        screen.getByRole('checkbox', { name: /Publish new versions/ }),
      ).not.toBeChecked();
      expect(screen.getByRole('combobox', { name: /SHA256SUMS/ })).toHaveValue(
        'disabled',
      );
    });

    it('sends the name with the defaults of the file plugin, null for what was left blank, and goes to the new repository', async () => {
      serveLab();
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.click(save());

      await atDetail('tools');
      expect(bodiesOf(REPOSITORY_PATH)).toStrictEqual([
        {
          name: 'tools',
          description: null,
          retain_repo_versions: null,
          autopublish: false,
          sha256sums: 'disabled',
          pulp_labels: {},
          remote: null,
        },
      ]);
      expect(writes()).toHaveLength(1);
      expect(
        await screen.findByText('Successfully created repository tools'),
      ).toBeInTheDocument();
    });

    it('sends what the user filled in: description, a number of versions, the plugin options, labels and the remote', async () => {
      const mirror = pluginRemote('file', { name: 'mirror' });
      serveLab({ remotes: [mirror] });
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.type(
        screen.getByRole('textbox', { name: /Description/ }),
        'build tools',
      );
      await user.type(retained(), '5');
      await user.click(
        screen.getByRole('checkbox', { name: /Publish new versions/ }),
      );
      await user.selectOptions(
        screen.getByRole('combobox', { name: /SHA256SUMS/ }),
        'root',
      );
      await user.click(screen.getByRole('button', { name: /Add label/ }));
      await user.type(
        screen.getByRole('textbox', { name: 'Label key' }),
        'env',
      );
      await user.type(
        screen.getByRole('textbox', { name: 'Label value' }),
        'prod',
      );
      await user.click(
        await screen.findByRole('combobox', { name: 'Select a remote' }),
      );
      await user.click(await screen.findByRole('option', { name: 'mirror' }));
      await user.click(save());

      await atDetail('tools');
      expect(bodiesOf(REPOSITORY_PATH)).toStrictEqual([
        {
          name: 'tools',
          description: 'build tools',
          retain_repo_versions: 5,
          autopublish: true,
          sha256sums: 'root',
          pulp_labels: { env: 'prod' },
          remote: mirror.pulp_href,
        },
      ]);
    });

    it('keeps a typed 0 in the retained versions field and shows the refusal of the server under it', async () => {
      serveLab({
        repositoryAnswer: () =>
          HttpResponse.json(
            {
              retain_repo_versions: [
                'Ensure this value is greater than or equal to 1.',
              ],
            },
            { status: 400 },
          ),
      });
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.type(retained(), '0');
      expect(retained()).toHaveValue(0);
      await user.click(save());

      expect(
        await screen.findByText(
          'Ensure this value is greater than or equal to 1.',
        ),
      ).toBeInTheDocument();
      expect(retained()).toHaveValue(0);
      expect(retained()).toHaveAttribute('aria-invalid', 'true');
      expect(bodiesOf(REPOSITORY_PATH)[0]).toMatchObject({
        retain_repo_versions: 0,
      });
      await waitFor(() => expect(save()).toBeEnabled());
    });

    it('shows the message of the server under Name when the name is taken, and stays on the form', async () => {
      serveLab({
        repositoryAnswer: () =>
          HttpResponse.json(
            { name: ['This field must be unique.'] },
            { status: 400 },
          ),
      });
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.click(save());

      expect(
        await screen.findByText('This field must be unique.'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/repository/new',
      );
      expect(nameInput()).toHaveValue('tools');
    });

    it('shows a refusal as an alert with its three parts and keeps what was typed', async () => {
      serveLab({
        repositoryAnswer: () =>
          HttpResponse.json({ detail: 'Not allowed here.' }, { status: 403 }),
      });
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.click(save());

      const reason = await screen.findByText('Not allowed here.');
      const alert = reason.closest('.pf-v6-c-alert') as HTMLElement;
      expect(alert).not.toBeNull();
      expect(
        Array.from(alert.querySelectorAll('p')).map((part) => part.textContent),
      ).toEqual([
        'You do not have permission to do this.',
        'Not allowed here.',
        'Contact your organization administrator for more information.',
      ]);
      expect(nameInput()).toHaveValue('tools');
    });

    it('shows a long unbroken refusal in an alert that wraps', async () => {
      const refusal = 'x'.repeat(500);
      serveLab({
        repositoryAnswer: () =>
          HttpResponse.json({ detail: refusal }, { status: 403 }),
      });
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.click(save());

      const message = await screen.findByText(refusal);
      expect(message.closest('.pulp-break-anywhere')).not.toBeNull();
    });

    it('sends one POST for a double click on Save and keeps Save off while it is pending', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lab = serveLab();
      server.use(
        http.post(`*${REPOSITORY_PATH}`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>;
          posted.push({ path: REPOSITORY_PATH, body });
          await gate;
          const created = pluginRepository('file', {
            name: String(body['name']),
          });
          lab.repositories.push(created);
          return HttpResponse.json(created, { status: 201 });
        }),
      );
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.dblClick(save());

      await waitFor(() => expect(save()).toBeDisabled());
      expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1);
      release();
      await atDetail('tools');
      expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1);
    });

    it('sends one POST when the second click arrives before the page has re-rendered', async () => {
      serveLab();
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      const button = save();
      act(() => {
        button.click();
        button.click();
      });

      await atDetail('tools');
      expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1);
    });

    it('goes back to the list on Cancel without a request', async () => {
      serveLab();
      const { user } = renderCreate();

      await formReady();
      await user.type(nameInput(), 'tools');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          /^\/file\/repositories\/?$/,
        ),
      );
      expect(writes()).toStrictEqual([]);
    });

    it('keeps what was typed when the session ends during the save, and shows no message', async () => {
      serveSignIn();
      serveLab({
        repositoryAnswer: () =>
          HttpResponse.json({ detail: 'expired' }, { status: 401 }),
      });
      const { user } = renderWithProviders(
        <>
          <SignInAgain />
          <AppContextProvider>
            <Routed />
          </AppContextProvider>
        </>,
        { route: '/file/repository/new' },
      );
      await formReady();
      await signedIn();
      await user.type(nameInput(), 'tools');

      await user.click(save());

      await waitFor(() => expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1));
      expect(nameInput()).toHaveValue('tools');
      expect(screen.queryByText(/expired/)).toBeNull();
      expect(
        screen.queryByText('You do not have permission to do this.'),
      ).toBeNull();
    });
  },
);

describe(
  'Integration: the distribution option of the create form',
  { tags: ['integration'] },
  () => {
    const tick = async (user: ReturnType<typeof renderCreate>['user']) =>
      user.click(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      );

    it('offers the box unticked, with no base path field yet and a generic label while Name is empty', async () => {
      serveLab();
      renderCreate();

      const box = await screen.findByRole('checkbox', {
        name: 'Create a distribution for this repository',
      });

      expect(box).not.toBeChecked();
      expect(screen.queryByRole('textbox', { name: /Base path/ })).toBeNull();
    });

    it('shows the base path and the warning about a missing content guard once the box is ticked', async () => {
      serveLab();
      const { user } = renderCreate();

      await formReady();
      await tick(user);

      expect(basePathInput()).toBeInTheDocument();
      expect(screen.getByText(/no content guard/)).toBeInTheDocument();
    });

    it('follows the name for the base path until the user types one, and previews the server URL', async () => {
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);

      expect(basePathInput()).toHaveValue('tools');
      expect(
        await screen.findByText(
          'URL (preview): https://pulp.example/pulp/content/tools/',
        ),
      ).toBeInTheDocument();

      await user.clear(basePathInput());
      await user.type(basePathInput(), 'own');
      await user.type(nameInput(), '2');

      expect(basePathInput()).toHaveValue('own');
    });

    it('turns what is not allowed in a base path into underscores and keeps a dot', async () => {
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools 1.0');
      await tick(user);

      expect(basePathInput()).toHaveValue('tools_1.0');
    });

    it('previews no URL, and still works, when the status answer holds no content settings', async () => {
      serveLab({ contentSettings: null });
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);

      expect(
        await screen.findByText(
          'The client URL is shown on the repository page once the distribution exists.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText(/URL \(preview\)/)).toBeNull();
      expect(save()).toBeEnabled();
    });

    it('shows the typed name verbatim in the label, quotes and non-ASCII letters included, and markup as text', async () => {
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), "O'Brien-żółw");
      expect(
        screen.getByRole('checkbox', {
          name: 'Create a distribution "O\'Brien-żółw" for this repository',
        }),
      ).toBeInTheDocument();

      await user.clear(nameInput());
      await user.type(nameInput(), '<b>x</b>');
      expect(
        screen.getByRole('checkbox', {
          name: 'Create a distribution "<b>x</b>" for this repository',
        }),
      ).toBeInTheDocument();
      expect(document.querySelector('label b')).toBeNull();
    });

    it('asks for a distribution at the typed base path only when the box is ticked', async () => {
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await user.click(save());
      await atDetail('tools');
      expect(bodiesOf(DISTRIBUTION_PATH)).toStrictEqual([]);
      expect(
        seen.filter((r) => r.path === `${API}/distributions/`),
      ).toHaveLength(0);
    });

    it('creates the repository, then the distribution bound to it at the chosen base path, and reports both', async () => {
      const lab = serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);
      await user.clear(basePathInput());
      await user.type(basePathInput(), 'tools/stable');
      await user.click(save());

      await atDetail('tools');
      expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1);
      expect(bodiesOf(DISTRIBUTION_PATH)).toStrictEqual([
        {
          name: 'tools',
          base_path: 'tools/stable',
          repository: lab.repositories[0]?.pulp_href,
        },
      ]);
      expect(writes().map((r) => r.path)).toStrictEqual([
        REPOSITORY_PATH,
        DISTRIBUTION_PATH,
      ]);
      expect(
        await screen.findByText('Successfully created repository tools'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Created distribution "tools" at base path tools/stable.',
        ),
      ).toBeInTheDocument();
    });

    it('stops before the first write and names the clash under the fields when the name and the base path are taken', async () => {
      serveLab({
        distributions: [
          distribution({ name: 'tools', base_path: 'elsewhere' }),
          distribution({ name: 'other', base_path: 'tools' }),
        ],
      });
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);
      await user.click(save());

      expect(
        await screen.findByText('A distribution named "tools" already exists.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /The base path "tools" is already used by or overlaps/,
        ),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/repository/new',
      );
    });

    it('stops before the first write and says nothing was created when the check cannot run', async () => {
      serveLab();
      server.use(
        http.get(`*${API}/distributions/`, () =>
          HttpResponse.json({ detail: 'broken' }, { status: 500 }),
        ),
      );
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);
      await user.click(save());

      expect(
        await screen.findByText(/Nothing was created/),
      ).toBeInTheDocument();
      expect(writes()).toStrictEqual([]);
    });

    it('keeps the repository and reports the reason when the distribution is refused, without a second request or a delete', async () => {
      serveLab({
        distributionAnswer: () =>
          HttpResponse.json(
            { detail: 'You may not add distributions.' },
            { status: 403 },
          ),
      });
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await tick(user);
      await user.click(save());

      await atDetail('tools');
      expect(
        await screen.findByText(
          /Repository "tools" was created. The distribution "tools" was not created: .*You may not add distributions\./,
        ),
      ).toBeInTheDocument();
      expect(bodiesOf(REPOSITORY_PATH)).toHaveLength(1);
      expect(bodiesOf(DISTRIBUTION_PATH)).toHaveLength(1);
      expect(seen.filter((r) => r.method === 'DELETE')).toStrictEqual([]);
    });

    it('reports the repository as created and the distribution as not confirmed when the session ends during the distribution request', async () => {
      serveSignIn();
      serveLab({
        distributionAnswer: () =>
          HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      });
      const { user } = renderWithProviders(
        <>
          <SignInAgain />
          <AppContextProvider>
            <Routed />
          </AppContextProvider>
        </>,
        { route: '/file/repository/new' },
      );
      await formReady();
      await signedIn();
      await user.type(nameInput(), 'tools');
      await tick(user);
      await user.click(save());

      await waitFor(() =>
        expect(queuedTitles).toContain(
          'Repository "tools" was created. Its distribution was not confirmed.',
        ),
      );
      expect(bodiesOf(DISTRIBUTION_PATH)).toHaveLength(1);
    });
  },
);

describe(
  'Integration: base path rules of the create form',
  { tags: ['integration'] },
  () => {
    async function tickAndType(path: string) {
      serveLab();
      const rendered = renderCreate();
      await rendered.user.type(await formReady(), 'zz-test-repo');
      await rendered.user.click(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      );
      await rendered.user.clear(basePathInput());
      await rendered.user.type(basePathInput(), path);
      return rendered;
    }

    it('accepts a base path with a dot, a plus sign and a tilde', async () => {
      await tickAndType('tools-1.0/a+b~c');

      expect(screen.queryByText(/A base path cannot/)).toBeNull();
      expect(save()).toBeEnabled();
    });

    it('refuses a space and blocks Save with a reason', async () => {
      await tickAndType('a b');

      expect(
        screen.getByText('A base path cannot contain spaces, "?" or "#".'),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('refuses a dot segment and blocks Save with a reason', async () => {
      await tickAndType('a/../b');

      expect(
        screen.getByText('A base path cannot contain a "." or ".." segment.'),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('refuses an empty base path and slashes at the ends', async () => {
      const { user } = await tickAndType('x');
      await user.clear(basePathInput());

      expect(screen.getByText('Enter a base path.')).toBeInTheDocument();
      expect(save()).toBeDisabled();

      await user.type(basePathInput(), '/x');

      expect(
        screen.getByText(/cannot start or end with a slash/),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('refuses a base path under a configured reserved prefix with a message and blocks Save', async () => {
      settings.reservedPrefixes = ['reserved/'];

      await tickAndType('reserved/x');

      expect(
        screen.getByText(/Base paths starting with "reserved\/" are reserved/),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('refuses the bare prefix itself as well', async () => {
      settings.reservedPrefixes = ['reserved/'];

      await tickAndType('reserved');

      expect(
        screen.getByText(/are reserved on this server/),
      ).toBeInTheDocument();
      expect(save()).toBeDisabled();
    });

    it('accepts a base path outside the reserved prefixes and one that only shares the first letters', async () => {
      settings.reservedPrefixes = ['reserved/'];

      await tickAndType('reservedly/x');

      expect(screen.queryByText(/are reserved on this server/)).toBeNull();
      expect(save()).toBeEnabled();
    });

    it('does not check the base path when no distribution is requested', async () => {
      settings.reservedPrefixes = ['reserved/'];
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'reserved');

      expect(screen.queryByText(/are reserved on this server/)).toBeNull();
      expect(save()).toBeEnabled();
    });
  },
);

describe(
  'Integration: reserved base paths that are unknown',
  { tags: ['integration'] },
  () => {
    const unknownReason =
      /reserved base paths of this server could not be read/;

    it.each([
      ['the configuration fell back to its defaults', null],
      ['the served configuration does not list them', undefined],
    ])(
      'disables the distribution option with a reason when %s',
      async (_case, prefixes) => {
        settings.reservedPrefixes = prefixes;
        serveLab();

        renderCreate();

        expect(
          await screen.findByRole('checkbox', {
            name: /Create a distribution/,
          }),
        ).toBeDisabled();
        expect(screen.getByText(unknownReason)).toBeInTheDocument();
      },
    );

    it('still lets a repository be created without a distribution', async () => {
      settings.reservedPrefixes = null;
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      await user.click(save());

      await atDetail('tools');
      expect(bodiesOf(DISTRIBUTION_PATH)).toStrictEqual([]);
    });

    it('offers the option when the deployment lists no reserved prefix', async () => {
      settings.reservedPrefixes = [];
      serveLab();
      const { user } = renderCreate();

      await user.type(await formReady(), 'tools');
      const box = await screen.findByRole('checkbox', {
        name: /Create a distribution/,
      });

      expect(box).toBeEnabled();
      expect(screen.queryByText(unknownReason)).toBeNull();

      await user.click(box);
      await user.clear(basePathInput());
      await user.type(basePathInput(), 'any/path');

      expect(save()).toBeEnabled();
    });
  },
);

describe(
  'Integration: who sees the create form and the distribution option',
  { tags: ['integration'] },
  () => {
    const ADD = 'file.add_filerepository';
    const ADD_DISTRIBUTION = 'file.add_filedistribution';
    const settled = () => new Promise((resolve) => setTimeout(resolve, 150));

    function renderAs() {
      return renderWithProviders(
        <AppContextProvider>
          <Routed />
        </AppContextProvider>,
        { route: '/file/repository/new', signedIn: true },
      );
    }

    it('shows the insufficient permissions page, with no form and no write, to an account that may not add repositories', async () => {
      serveAccount({ isStaff: false, own: [['file.view_filerepository']] });
      serveLab();

      renderAs();

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /Name/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
      await settled();
      expect(writes()).toStrictEqual([]);
    });

    it('does not take a role on a single repository for the permission to add one', async () => {
      serveAccount({ isStaff: false, own: [['file.change_filerepository']] });
      serveLab();

      renderAs();

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
    });

    it('shows the form without the distribution option to an account that may add repositories but not distributions', async () => {
      serveAccount({ isStaff: false, own: [[ADD]] });
      serveLab();
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));
      const { user } = renderAs();

      await user.type(await formReady(), 'tools');

      expect(distributionBox()).toBeNull();
      expect(screen.queryByText('Distributions')).toBeNull();
      await user.click(save());
      await atDetail('tools');
      expect(bodiesOf(DISTRIBUTION_PATH)).toStrictEqual([]);
    });

    it('does not take the permission to add a distribution for the one to add a repository', async () => {
      serveAccount({ isStaff: false, own: [[ADD_DISTRIBUTION]] });
      serveLab();

      renderAs();

      expect(
        await screen.findByRole('heading', {
          name: 'Insufficient permissions',
        }),
      ).toBeInTheDocument();
    });

    it('shows the option to an account that holds both permissions', async () => {
      serveAccount({ isStaff: false, own: [[ADD, ADD_DISTRIBUTION]] });
      serveLab();

      renderAs();

      expect(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeInTheDocument();
    });

    it('shows the option to staff, who hold every permission', async () => {
      serveAccount({ isStaff: true });
      serveLab();

      renderAs();

      expect(
        await screen.findByRole('checkbox', { name: /Create a distribution/ }),
      ).toBeInTheDocument();
    });

    it('shows the loading state, and no form and no refusal, while the permissions are read', async () => {
      serveAccount({ isStaff: false });
      serveLab();
      server.use(
        http.get(`*${API}/users/7/`, () => new Promise(() => undefined)),
      );

      renderAs();

      await screen.findByRole('progressbar');
      await settled();
      expect(screen.getByRole('progressbar')).toBeVisible();
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();
      expect(
        screen.queryByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeNull();
    });

    it('shows a failed permission read with Retry, never as a refusal and never as a spinner, and shows the form once the read succeeds', async () => {
      serveAccount({ isStaff: true });
      serveLab();
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
      expect(screen.queryByRole('button', { name: /^Save/ })).toBeNull();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await formReady()).toBeInTheDocument();
    });
  },
);
