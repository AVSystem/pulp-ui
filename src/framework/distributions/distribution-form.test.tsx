import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IContentGuard,
  type IDistribution,
  type IRepository,
  type TestDistributionPlugin,
  contentGuard,
  contentGuardListHandler,
  corePublicationListHandler,
  coreRepositoryListHandler,
  listOf,
  pluginDistribution,
  pluginPublication,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  repository,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

// The configuration is loaded once when the application starts. The reserved
// prefixes are a made-up list, not those of any deployment.
const settings = vi.hoisted(() => ({
  reservedPrefixes: ['pulp/'] as string[] | null,
}));

vi.mock('src/ui-config', () => ({
  configPromise: Promise.resolve(),
  configFallback: () => undefined,
  get config() {
    return {
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
      ...(settings.reservedPrefixes === null
        ? {}
        : { RESERVED_BASE_PATH_PREFIXES: settings.reservedPrefixes }),
    };
  },
}));

const API = '/pulp/api/v3';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000cc/`;

const SEGMENTS: Record<TestDistributionPlugin, string> = {
  file: 'file/file',
  deb: 'deb/apt',
  rpm: 'rpm/rpm',
  python: 'python/pypi',
  maven: 'maven/maven',
  npm: 'npm/npm',
  ansible: 'ansible/ansible',
  container: 'container/container',
};

const REDIRECT_GUARD = contentGuard({
  name: 'content redirect',
  pulp_href: `${API}/contentguards/core/content_redirect/00000000-0000-4000-8000-0000000000ff/`,
});

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

let posted: { path: string; body: Record<string, unknown> }[];
let permissionServers: { stop: () => void }[];

const bodiesOf = (plugin: TestDistributionPlugin) =>
  posted
    .filter(({ path }) => path === `${API}/distributions/${SEGMENTS[plugin]}/`)
    .map(({ body }) => body);

beforeEach(() => {
  posted = [];
  permissionServers = [];
  settings.reservedPrefixes = ['pulp/'];
  permissionServers.push(servePermissions({ id: 7, isStaff: true }));
});

afterEach(() => {
  for (const served of permissionServers) {
    served.stop();
  }
});

interface Lab {
  plugin: TestDistributionPlugin;
  repositories?: IRepository[];
  publications?: ReturnType<typeof pluginPublication>[];
  guards?: IContentGuard[];
  // the distributions of every plugin that exist before the create
  existing?: IDistribution[];
  // how the task that creates the distribution ends
  task?: { state: string; error?: unknown };
}

// The lists the form and the page it returns to read, the POST that creates a
// distribution and the task that ends at once. The distribution that was
// created is listed from then on, with the content guard the server gives it:
// the one that was sent, or its own redirect guard for a container.
function serveLab({
  plugin,
  repositories = [],
  publications = [],
  guards = [],
  existing = [],
  task = { state: 'completed' },
}: Lab) {
  const created: IDistribution[] = [];
  const coreRows = () => [...existing, ...created];

  server.use(
    coreRepositoryListHandler(repositories).handler,
    corePublicationListHandler(publications).handler,
    contentGuardListHandler([...guards, REDIRECT_GUARD]).handler,
    ...(plugin === 'file' || plugin === 'deb' || plugin === 'rpm'
      ? [publicationListHandler(plugin, publications).handler]
      : []),
    http.get(`*${API}/distributions/${SEGMENTS[plugin]}/`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      const rows = created.filter(
        (row) => !query.has('name') || row.name === query.get('name'),
      );
      return HttpResponse.json({
        count: rows.length,
        next: null,
        previous: null,
        results: rows.map((row) => projectedBy(row, query)),
      });
    }),
    http.get(`*${API}/distributions/`, ({ request }) => {
      const query = new URL(request.url).searchParams;
      const hrefs = query.get('pulp_href__in')?.split(',');
      const paths = query.get('base_path__in')?.split(',');
      const contains = query.get('base_path__contains');
      const rows = coreRows().filter((row) => {
        if (query.has('name')) {
          return row.name === query.get('name');
        }
        if (hrefs) {
          return hrefs.includes(row.pulp_href);
        }
        if (paths) {
          return paths.includes(row.base_path);
        }
        if (contains !== null) {
          return row.base_path.includes(contains);
        }
        return true;
      });
      return HttpResponse.json({
        count: rows.length,
        next: null,
        previous: null,
        results: rows.map((row) => projectedBy(row, query)),
      });
    }),
    http.get(`*${API}/status/`, () =>
      HttpResponse.json({
        versions: [
          { component: 'core', version: '3.0.0' },
          { component: plugin, version: '3.0.0' },
        ],
        content_settings: {
          content_origin: 'https://pulp.example',
          content_path_prefix: '/pulp/content/',
        },
      }),
    ),
    http.get('*/pulp/api/v3/tasks/:id/', () =>
      HttpResponse.json({
        pulp_href: TASK_HREF,
        name: 'create',
        ...task,
        created_resources: created.map((row) => row.pulp_href),
      }),
    ),
    http.post(
      `*${API}/distributions/${SEGMENTS[plugin]}/`,
      async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>;
        posted.push({
          path: `${API}/distributions/${SEGMENTS[plugin]}/`,
          body,
        });
        if (task.state === 'completed') {
          created.push(
            pluginDistribution(plugin, {
              name: String(body['name']),
              base_path: String(body['base_path']),
              repository: (body['repository'] as string | undefined) ?? null,
              publication: (body['publication'] as string | undefined) ?? null,
              content_guard:
                'content_guard' in body
                  ? (body['content_guard'] as string | null)
                  : plugin === 'container'
                    ? REDIRECT_GUARD.pulp_href
                    : null,
            }),
          );
        }
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      },
    ),
    // an account that is not an administrator reads the roles
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
}

function renderForm(plugin: TestDistributionPlugin, query = '') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed plugin={plugin} />
      </PermissionsKnown>
    </AppContextProvider>,
    { route: `/${plugin}/distribution/new${query}`, signedIn: true },
  );
}

const nameInput = () => screen.getByRole('textbox', { name: /^Name/ });
const basePathInput = () => screen.getByRole('textbox', { name: /^Base path/ });
const create = () => screen.getByRole('button', { name: /^Create/ });
const formReady = () => screen.findByRole('textbox', { name: /^Name/ });
const publicRadio = () => screen.getByRole('radio', { name: /^Public/ });
const protectedRadio = () =>
  screen.getByRole('radio', { name: /Protected by a content guard/ });
const atDetail = (name: string, plugin = 'file') =>
  waitFor(() =>
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^/${plugin}/distributions/${name}/?$`),
    ),
  );

type User = ReturnType<typeof renderForm>['user'];

async function pickRepository(user: User, name: string) {
  await user.click(
    await screen.findByRole('combobox', { name: 'Select a repository' }),
  );
  await user.click(await screen.findByRole('option', { name }));
}

async function fill(user: User, name: string, basePath: string) {
  await user.type(await formReady(), name);
  await user.type(basePathInput(), basePath);
}

describe(
  'Integration: the distribution create form',
  { tags: ['integration'] },
  () => {
    it('creates a file distribution that serves one publication: name, base path, guard, the publication and nothing else', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      const older = pluginPublication('file', {
        repository: tools.pulp_href,
        repository_version: `${tools.pulp_href}versions/1/`,
        pulp_created: '2024-01-01T10:00:00.000000Z',
      });
      const newer = pluginPublication('file', {
        repository: tools.pulp_href,
        repository_version: `${tools.pulp_href}versions/2/`,
        pulp_created: '2024-02-01T10:00:00.000000Z',
      });
      serveLab({
        plugin: 'file',
        repositories: [tools],
        publications: [older, newer],
      });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await pickRepository(user, 'tools-repo');
      await user.click(screen.getByRole('radio', { name: /^One publication/ }));
      const select = await screen.findByRole('combobox', {
        name: /^Publication/,
      });
      // the newest publication comes first
      await waitFor(() =>
        expect(
          within(select)
            .getAllByRole('option')
            .map((option) => option.textContent),
        ).toStrictEqual([
          'Choose a publication',
          expect.stringMatching(/^Version 2/),
          expect.stringMatching(/^Version 1/),
        ]),
      );
      await user.selectOptions(select, newer.pulp_href);
      await user.click(publicRadio());
      await user.click(create());

      await atDetail('tools-dist');
      expect(bodiesOf('file')).toStrictEqual([
        {
          name: 'tools-dist',
          base_path: 'served/tools',
          content_guard: null,
          publication: newer.pulp_href,
        },
      ]);
    });

    it('offers a file distribution the repository (its newest publication) as the other way to serve', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({ plugin: 'file', repositories: [tools] });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await pickRepository(user, 'tools-repo');
      expect(
        screen.getByRole('radio', { name: /^The repository/ }),
      ).toBeChecked();
      await user.click(publicRadio());
      await user.click(create());

      await atDetail('tools-dist');
      expect(bodiesOf('file')).toStrictEqual([
        {
          name: 'tools-dist',
          base_path: 'served/tools',
          content_guard: null,
          repository: tools.pulp_href,
        },
      ]);
    });

    it('creates a deb distribution that serves a repository, protected by the guard that was picked, with its labels', async () => {
      const apt = pluginRepository('deb', { name: 'apt-repo' });
      const guard = contentGuard({ name: 'customers-only' });
      serveLab({ plugin: 'deb', repositories: [apt], guards: [guard] });
      const { user } = renderForm('deb');

      await fill(user, 'apt-dist', 'served/apt');
      await pickRepository(user, 'apt-repo');
      await user.click(protectedRadio());
      await user.click(
        await screen.findByRole('combobox', { name: 'Select a content guard' }),
      );
      await user.click(
        await screen.findByRole('option', { name: /customers/ }),
      );
      await user.click(screen.getByRole('button', { name: /Add label/ }));
      await user.type(
        screen.getByRole('textbox', { name: 'Label key' }),
        'team',
      );
      await user.type(
        screen.getByRole('textbox', { name: 'Label value' }),
        'docs',
      );
      await user.click(create());

      await atDetail('apt-dist', 'deb');
      expect(bodiesOf('deb')).toStrictEqual([
        {
          name: 'apt-dist',
          base_path: 'served/apt',
          content_guard: guard.pulp_href,
          repository: apt.pulp_href,
          pulp_labels: { team: 'docs' },
        },
      ]);
    });

    it('offers a python distribution only its repository: there is no publication to choose', async () => {
      const index = pluginRepository('python', { name: 'index-repo' });
      serveLab({ plugin: 'python', repositories: [index] });
      const { user } = renderForm('python');

      await fill(user, 'index-dist', 'served/index');
      await pickRepository(user, 'index-repo');
      expect(screen.queryByRole('radio', { name: /publication/i })).toBeNull();
      await user.click(publicRadio());
      await user.click(create());

      await atDetail('index-dist', 'python');
      expect(bodiesOf('python')).toStrictEqual([
        {
          name: 'index-dist',
          base_path: 'served/index',
          content_guard: null,
          repository: index.pulp_href,
        },
      ]);
    });

    it('creates a container distribution with the generic fields only and never sends a content guard; the server manages it and the page says which', async () => {
      const images = repository({
        name: 'images-repo',
        pulp_href: `${API}/repositories/container/container/00000000-0000-4000-8000-0000000000a1/`,
      });
      serveLab({ plugin: 'container', repositories: [images] });
      const { user } = renderForm('container');

      await fill(user, 'images-dist', 'served/images');
      await pickRepository(user, 'images-repo');
      expect(screen.queryByRole('radio', { name: /^Public/ })).toBeNull();
      expect(
        screen.getByText(/The server manages the content guard/),
      ).toBeVisible();
      await user.click(create());

      await atDetail('images-dist', 'container');
      expect(bodiesOf('container')).toStrictEqual([
        {
          name: 'images-dist',
          base_path: 'served/images',
          repository: images.pulp_href,
        },
      ]);
      expect(
        await screen.findByText(
          'The server protected the distribution with "content redirect".',
        ),
      ).toBeInTheDocument();
    });

    it('keeps Create off until the protection is decided', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({ plugin: 'file', repositories: [tools] });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await pickRepository(user, 'tools-repo');

      expect(protectedRadio()).not.toBeChecked();
      expect(publicRadio()).not.toBeChecked();
      expect(create()).toBeDisabled();

      await user.click(protectedRadio());
      expect(create()).toBeDisabled();

      await user.click(publicRadio());
      expect(create()).toBeEnabled();
      expect(posted).toHaveLength(0);
    });

    it('keeps Create off until a repository is chosen and, for one publication, a publication', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      const made = pluginPublication('file', {
        repository: tools.pulp_href,
        repository_version: `${tools.pulp_href}versions/1/`,
      });
      serveLab({
        plugin: 'file',
        repositories: [tools],
        publications: [made],
      });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await user.click(publicRadio());
      expect(create()).toBeDisabled();

      await pickRepository(user, 'tools-repo');
      expect(create()).toBeEnabled();

      await user.click(screen.getByRole('radio', { name: /^One publication/ }));
      expect(create()).toBeDisabled();
    });

    it('fixes the repository when it is opened from a repository: no search, and the repository is what is served', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({ plugin: 'file', repositories: [tools] });
      const { user } = renderForm('file', '?repository=tools-repo');

      await fill(user, 'tools-dist', 'served/tools');
      expect(await screen.findByText('tools-repo')).toBeVisible();
      expect(
        screen.queryByRole('combobox', { name: 'Select a repository' }),
      ).toBeNull();
      await user.click(publicRadio());
      await user.click(create());

      await atDetail('tools-dist');
      expect(bodiesOf('file')[0]).toMatchObject({
        repository: tools.pulp_href,
      });
    });

    it('refuses a base path that breaks the rules or sits under a reserved prefix before anything is sent', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({ plugin: 'file', repositories: [tools] });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', '/bad');
      await pickRepository(user, 'tools-repo');
      await user.click(publicRadio());
      expect(create()).toBeDisabled();
      expect(
        screen.getByText(/cannot start or end with a slash/),
      ).toBeVisible();

      await user.clear(basePathInput());
      await user.type(basePathInput(), 'pulp/tools');
      expect(create()).toBeDisabled();
      expect(
        screen.getByText(/starting with "pulp\/" are reserved/),
      ).toBeVisible();
      expect(posted).toHaveLength(0);
    });

    it('says a name or a base path is taken before anything is written, and writes nothing', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      const other = pluginDistribution('python', {
        name: 'taken',
        base_path: 'served/taken',
      });
      serveLab({ plugin: 'file', repositories: [tools], existing: [other] });
      const { user } = renderForm('file');

      await fill(user, 'taken', 'served/taken');
      await pickRepository(user, 'tools-repo');
      await user.click(publicRadio());
      await user.click(create());

      expect(
        await screen.findByText('A distribution named "taken" already exists.'),
      ).toBeVisible();
      expect(
        screen.getByText(/The base path "served\/taken" is already used/),
      ).toBeVisible();
      expect(posted).toHaveLength(0);
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/distribution/new',
      );
    });

    it('stays on the form with the reason when the task that creates the distribution fails', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({
        plugin: 'file',
        repositories: [tools],
        task: { state: 'failed', error: { description: 'Base path is busy.' } },
      });
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await pickRepository(user, 'tools-repo');
      await user.click(publicRadio());
      await user.click(create());

      expect(await screen.findByText(/Base path is busy\./)).toBeVisible();
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/distribution/new',
      );
      await waitFor(() => expect(create()).toBeEnabled());
    });

    it('shows the server refusal of a field under it and keeps what was typed', async () => {
      const tools = pluginRepository('file', { name: 'tools-repo' });
      serveLab({ plugin: 'file', repositories: [tools] });
      server.use(
        http.post(`*${API}/distributions/file/file/`, () =>
          HttpResponse.json(
            { base_path: ['Overlaps with another distribution.'] },
            { status: 400 },
          ),
        ),
      );
      const { user } = renderForm('file');

      await fill(user, 'tools-dist', 'served/tools');
      await pickRepository(user, 'tools-repo');
      await user.click(publicRadio());
      await user.click(create());

      expect(
        await screen.findByText('Overlaps with another distribution.'),
      ).toBeVisible();
      expect(basePathInput()).toHaveValue('served/tools');
    });

    it('shows the insufficient permissions page to an account that may not add distributions', async () => {
      permissionServers.splice(0).forEach((served) => served.stop());
      permissionServers.push(servePermissions({ id: 8, isStaff: false }));
      serveLab({ plugin: 'file' });
      renderForm('file');

      expect(
        await screen.findByText(/do not have permission to view this page/i),
      ).toBeInTheDocument();
      expect(screen.queryByRole('textbox', { name: /^Name/ })).toBeNull();
    });
  },
);
