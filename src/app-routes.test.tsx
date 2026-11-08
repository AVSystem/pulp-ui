import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import RootRoute from 'src/routes/root';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import { dataRoutes } from './app-routes';

// The guarded routes of the application, without the lazily loaded layout
// around them. Entries without a path (the index redirect) are left out.
const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

function Routed() {
  const { pathname, search } = useLocation();
  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardedRoutes)}
    </>
  );
}

const PROTECTED_PATH = '/signature-keys';

// Holds the answer to GET login/ until the test releases it.
function holdSessionCheck(answer: () => Response) {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/pulp/api/v3/login/', async () => {
      await gate;
      return answer();
    }),
  );
  return release;
}

describe('route guard', () => {
  it('a protected route shows a loading state, not the login page, while the session check runs', async () => {
    const release = holdSessionCheck(() =>
      HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
    );

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    // Nothing has redirected while the check is pending.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();

    release();

    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent(/^\/login/),
    );
  });

  it('a protected route keeps its deep link when the session check answers 200', async () => {
    const { handler } = listOf('/pulp/api/v3/signing-services/', []);
    server.use(handler);
    const release = holdSessionCheck(() =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    );

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });
    release();

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it('a protected route redirects to the login page only when the session check answers 401', async () => {
    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent(PROTECTED_PATH)}`,
    );
  });

  it('a protected route sends its full return URL, query string included, to the login page', async () => {
    const target = '/signature-keys?page=2&sort=name';
    renderWithProviders(<Routed />, { route: target });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent(target)}`,
    );
  });

  it('a protected route without a query string sends the bare path, with no trailing question mark', async () => {
    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    const shown = screen.getByTestId('location').textContent ?? '';
    expect(shown).toBe(`/login/?next=${encodeURIComponent(PROTECTED_PATH)}`);
    expect(decodeURIComponent(shown)).not.toContain('?next=/signature-keys?');
  });

  it('a protected route keeps encoded characters in the query string byte for byte', async () => {
    const target = '/signature-keys?name=%C5%BC&q=a%26b';
    renderWithProviders(<Routed />, { route: target });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    const shown = screen.getByTestId('location').textContent ?? '';
    const next = new URL(shown, 'https://ui.example').searchParams.get('next');
    expect(next).toBe(target);
  });

  describe('with an external login address', () => {
    afterEach(() => {
      config.UI_EXTERNAL_LOGIN_URI = null;
      vi.restoreAllMocks();
    });

    it('a protected route passes the path with its query string to the external login address', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, {
        route: '/signature-keys?page=2&sort=name',
      });

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith(
        `https://login.example/start?next=${encodeURIComponent('/ui/signature-keys?page=2&sort=name')}`,
      );
    });
  });
});

// Answers the session check as a signed-in user.
function signIn() {
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

// The paths of every request the page sends while the callback runs.
function recordRequests() {
  const paths: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    paths.push(new URL(request.url).pathname);
  };
  server.events.on('request:start', onStart);
  return {
    paths,
    stop: () => server.events.removeListener('request:start', onStart),
  };
}

// The requests that are not the configuration file or the one shared read of
// the installed plugins, which every page makes.
function ownRequests(paths: string[]) {
  return paths.filter(
    (path) =>
      !path.endsWith('/pulp-ui-config.json') &&
      !path.endsWith('/pulp/api/v3/status/'),
  );
}

describe('placeholder screens', () => {
  it('the search route shows the placeholder with a link to the documentation', async () => {
    signIn();
    const requests = recordRequests();

    renderWithProviders(<Routed />, { route: '/search' });

    expect(
      await screen.findByRole('heading', { name: 'Search', level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByText('This screen is not available in this UI yet.'),
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: /Pulp documentation/ }),
    ).toHaveAttribute('href', 'https://pulpproject.org/pulp-cli/');

    requests.stop();
    // Only the session check, the configuration file and the installed
    // plugins are requested.
    expect(ownRequests(requests.paths)).toEqual(['/pulp/api/v3/login/']);
  });

  it('the search route sends a signed-out user to the login page first', async () => {
    renderWithProviders(<Routed />, { route: '/search' });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent('/search')}`,
    );
  });
});

const ANSIBLE_COUNTERPART = '/ansible/repositories/';
const ANSIBLE_DOCS = 'https://pulpproject.org/pulp_ansible/';
const CONTAINER_DOCS = 'https://pulpproject.org/pulp_container/';

// Every route that stands in for a screen planned to return: the address
// opened, the heading shown, the link to the working screen (if any) and the
// documentation link.
const placeholderRoutes: {
  path: string;
  heading: string;
  counterpart?: string;
  docs: string;
}[] = [
  ...[
    '/ansible/collections',
    '/ansible/collections/detail/r/ns/c',
    '/ansible/collections/content/r/ns/c',
    '/ansible/collections/content_docs/r/ns/c/module/m',
    '/ansible/collections/docs_index/r/ns/c',
    '/ansible/collections/docs_page/r/ns/c/p',
    '/ansible/collections/distributions/r/ns/c',
    '/ansible/collections/dependencies/r/ns/c',
  ].map((path) => ({
    path,
    heading: 'Collections',
    counterpart: ANSIBLE_COUNTERPART,
    docs: ANSIBLE_DOCS,
  })),
  ...['/ansible/namespaces', '/ansible/namespaces/detail/ns'].map((path) => ({
    path,
    heading: 'Namespaces',
    counterpart: ANSIBLE_COUNTERPART,
    docs: ANSIBLE_DOCS,
  })),
  ...[
    '/container/containers',
    '/container/containers/detail/c',
    '/container/containers/images/ns/c',
    '/container/containers/activity/c',
    '/container/containers/access/c',
    '/container/containers/manifest/ns/c/sha256:0',
  ].map((path) => ({
    path,
    heading: 'Containers',
    docs: CONTAINER_DOCS,
  })),
  {
    path: '/container/remotes',
    heading: 'Remote registries',
    docs: CONTAINER_DOCS,
  },
];

// Segments of the addresses above that a placeholder must never show.
const ADDRESS_PARAMETERS = ['ns', 'c', 'r', 'm', 'p', 'sha256:0'];

describe('placeholder screens of the planned features', () => {
  it.each(placeholderRoutes)(
    '$path shows the $heading placeholder and sends no request of its own',
    async ({ path, heading, counterpart, docs }) => {
      signIn();
      const requests = recordRequests();

      renderWithProviders(<Routed />, { route: path });

      expect(
        await screen.findByRole('heading', { name: heading, level: 1 }),
      ).toBeVisible();
      expect(
        screen.getByText('This screen is not available in this UI yet.'),
      ).toBeVisible();
      expect(
        screen.getByRole('link', { name: /Pulp documentation/ }),
      ).toHaveAttribute('href', docs);
      if (counterpart) {
        expect(
          screen.getByRole('link', { name: 'Ansible repositories' }),
        ).toHaveAttribute('href', counterpart);
      } else {
        expect(screen.getAllByRole('link')).toHaveLength(1);
      }

      requests.stop();
      expect(ownRequests(requests.paths)).toEqual(['/pulp/api/v3/login/']);
    },
  );

  it.each(placeholderRoutes.filter(({ path }) => path.split('/').length > 3))(
    '$path shows none of the parameters of its address',
    async ({ path }) => {
      signIn();

      renderWithProviders(<Routed />, { route: path });
      await screen.findByText('This screen is not available in this UI yet.');

      // The location line of the test harness is the only text that may
      // repeat the address.
      const shown = Array.from(
        document.querySelectorAll('body *:not([data-testid=location])'),
      )
        .filter((element) => element.children.length === 0)
        .map((element) => element.textContent?.trim() ?? '');
      for (const parameter of ADDRESS_PARAMETERS) {
        expect(shown).not.toContain(parameter);
      }
      expect(shown.join(' ')).not.toContain('sha256');
    },
  );
});

describe('routes of removed galaxy_ng workflows', () => {
  it.each([
    '/ansible/approvals',
    '/ansible/my-namespaces',
    '/ansible/namespaces/edit/ns',
    '/ansible/my-imports',
    '/ansible/collections/imports/r/ns/c',
  ])('%s shows the 404 page', async (path) => {
    signIn();
    const requests = recordRequests();

    renderWithProviders(<Routed />, { route: path });

    expect(
      await screen.findByRole('heading', {
        name: '404 - Page not found',
        level: 1,
      }),
    ).toBeVisible();

    requests.stop();
    expect(ownRequests(requests.paths)).toEqual(['/pulp/api/v3/login/']);
  });
});

// Answers status/ with the given plugin labels.
function reportPlugins(components: string[]) {
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: components.map((component) => ({
          component,
          version: '3.0.0',
        })),
      }),
    ),
  );
}

const ALL_PLUGINS = [
  'core',
  'file',
  'certguard',
  'ansible',
  'container',
  'deb',
  'python',
  'rpm',
];
const WITHOUT_CONTAINER = ALL_PLUGINS.filter((name) => name !== 'container');

describe('routes of a plugin the server does not report', () => {
  it('a container route says the container plugin is not installed and links to the status page', async () => {
    signIn();
    reportPlugins(WITHOUT_CONTAINER);

    renderWithProviders(<Routed />, { route: '/container/containers' });

    expect(
      await screen.findByRole('heading', {
        name: 'Plugin not installed',
        level: 1,
      }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'The container plugin is not installed on this Pulp server.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('link', { name: 'Status' })).toHaveAttribute(
      'href',
      '/status/',
    );
    expect(
      screen.queryByText('This screen is not available in this UI yet.'),
    ).not.toBeInTheDocument();
  });

  it('a container route shows its placeholder when the server reports the container plugin', async () => {
    signIn();
    reportPlugins(ALL_PLUGINS);

    renderWithProviders(<Routed />, { route: '/container/containers' });

    expect(
      await screen.findByRole('heading', { name: 'Containers', level: 1 }),
    ).toBeVisible();
    expect(screen.queryByText(/is not installed/)).not.toBeInTheDocument();
  });

  it('the not installed page shows none of the parameters of the address', async () => {
    signIn();
    reportPlugins(WITHOUT_CONTAINER);

    renderWithProviders(<Routed />, {
      route: '/container/containers/manifest/ns/c/sha256:0',
    });
    await screen.findByText(/plugin is not installed/);

    const shown = Array.from(
      document.querySelectorAll('body *:not([data-testid=location])'),
    )
      .filter((element) => element.children.length === 0)
      .map((element) => element.textContent?.trim() ?? '');
    for (const parameter of ['ns', 'c']) {
      expect(shown).not.toContain(parameter);
    }
    expect(shown.join(' ')).not.toContain('sha256');
  });
});

// Holds the answer to GET status/ until the test releases it.
function holdStatus() {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    http.get('*/pulp/api/v3/status/', async () => {
      await gate;
      return HttpResponse.json({
        versions: ALL_PLUGINS.map((component) => ({
          component,
          version: '3.0.0',
        })),
      });
    }),
  );
  return release;
}

// Answers status/ with a failure first and the given plugins afterwards, and
// counts the requests.
function failStatusOnce(afterwards: string[]) {
  const counter = { requests: 0 };
  server.use(
    http.get('*/pulp/api/v3/status/', () => {
      counter.requests += 1;
      if (counter.requests === 1) {
        return HttpResponse.json({ detail: 'Failed.' }, { status: 500 });
      }
      return HttpResponse.json({
        versions: afterwards.map((component) => ({
          component,
          version: '3.0.0',
        })),
      });
    }),
  );
  return counter;
}

describe('plugin routes while the installed plugins are unknown', () => {
  it('a signed-out user is sent to the login page whatever status answers', async () => {
    const release = holdStatus();

    renderWithProviders(<Routed />, { route: '/rpm/repositories' });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      `/login/?next=${encodeURIComponent('/rpm/repositories')}`,
    );
    release();
  });

  it('a plugin route shows the loading page, not a verdict, while status is pending', async () => {
    signIn();
    const release = holdStatus();

    renderWithProviders(<Routed />, { route: '/ansible/collections' });

    expect(await screen.findByRole('progressbar')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByText(/is not installed/)).not.toBeInTheDocument();
    expect(
      screen.queryByText('This screen is not available in this UI yet.'),
    ).not.toBeInTheDocument();

    release();
    expect(
      await screen.findByRole('heading', { name: 'Collections', level: 1 }),
    ).toBeVisible();
  });

  it('a failed status shows the error state, never not installed, and Retry asks again', async () => {
    signIn();
    const counter = failStatusOnce(ALL_PLUGINS);
    const { user } = renderWithProviders(<Routed />, {
      route: '/ansible/collections',
    });

    expect(
      await screen.findByText('Could not read the installed plugins'),
    ).toBeVisible();
    expect(screen.queryByText(/is not installed/)).not.toBeInTheDocument();
    expect(counter.requests).toBe(1);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Collections', level: 1 }),
    ).toBeVisible();
    expect(counter.requests).toBe(2);
    expect(
      screen.queryByText('Could not read the installed plugins'),
    ).not.toBeInTheDocument();
  });

  it('Retry reports the plugin as not installed once the server answers without it', async () => {
    signIn();
    failStatusOnce(WITHOUT_CONTAINER);
    const { user } = renderWithProviders(<Routed />, {
      route: '/container/containers',
    });

    await user.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByText(
        'The container plugin is not installed on this Pulp server.',
      ),
    ).toBeVisible();
  });

  it.each([
    ['ansible', '/ansible/repositories'],
    ['deb', '/deb/repositories'],
    ['file', '/file/repositories'],
    ['python', '/python/repositories'],
    ['rpm', '/rpm/repositories'],
    ['ansible', '/ansible/namespaces'],
    ['rpm', '/rpm/remotes/edit/r1'],
  ])(
    'the %s plugin is reported as not installed on %s when status lacks it',
    async (plugin, path) => {
      signIn();
      reportPlugins(ALL_PLUGINS.filter((name) => name !== plugin));

      renderWithProviders(<Routed />, { route: path });

      expect(
        await screen.findByText(
          `The ${plugin} plugin is not installed on this Pulp server.`,
        ),
      ).toBeVisible();
    },
  );

  it('core routes and search render while status fails', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Failed.' }, { status: 500 }),
      ),
      listOf('/pulp/api/v3/signing-services/', []).handler,
      listOf('/pulp/api/v3/tasks/', []).handler,
    );

    const keys = renderWithProviders(<Routed />, { route: '/signature-keys' });
    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    keys.unmount();

    const tasks = renderWithProviders(<Routed />, { route: '/tasks' });
    expect(
      await screen.findByRole('heading', { name: 'Task management' }),
    ).toBeVisible();
    tasks.unmount();

    renderWithProviders(<Routed />, { route: '/search' });
    expect(
      await screen.findByRole('heading', { name: 'Search', level: 1 }),
    ).toBeVisible();
    expect(
      screen.queryByText('Could not read the installed plugins'),
    ).not.toBeInTheDocument();
  });
});

describe('lazily loaded screens', () => {
  it('keeps the layout in the entry: the root route is static', () => {
    expect(dataRoutes[0]).toMatchObject({ id: 'root', Component: RootRoute });
    expect(dataRoutes[0]).not.toHaveProperty('lazy');
  });

  it('shows the status screen on a deep link while signed out', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'core', version: '3.0.0' }],
          content_settings: {
            content_origin: 'https://content.example',
            content_path_prefix: '/pulp/content/',
          },
          database_connection: { connected: true },
          redis_connection: { connected: true },
          domain_enabled: false,
          online_workers: [],
          online_api_apps: [],
          online_content_apps: [],
        }),
      ),
    );

    renderWithProviders(<Routed />, { route: '/status' });

    expect(
      await screen.findByRole('heading', { name: 'Status' }),
    ).toBeVisible();
  });

  it('shows a plugin section screen on a deep link once its code has loaded', async () => {
    signIn();
    server.use(
      listOf('/pulp/api/v3/repositories/file/file/', [
        repository({ name: 'zz-test-repo' }),
      ]).handler,
      listOf('/pulp/api/v3/remotes/file/file/', []).handler,
      listOf('/pulp/api/v3/distributions/file/file/', []).handler,
    );

    renderWithProviders(
      <AppContextProvider>
        <Routed />
      </AppContextProvider>,
      { route: '/file/repositories' },
    );

    expect(await screen.findByText('zz-test-repo')).toBeVisible();
  });
});
