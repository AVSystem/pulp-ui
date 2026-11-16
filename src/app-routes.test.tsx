import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { useLocation, useNavigate, useRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import RootRoute from 'src/routes/root';
import { servePermissions } from 'src/test-utils/permissions';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { settle } from 'src/test-utils/settle';
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

  it('a protected route shows that the session could not be checked, with no redirect, when the check answers 500', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(
      await screen.findByRole('heading', {
        name: 'The session could not be checked',
      }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
    expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument();
  });

  it('a protected route shows that the session could not be checked when the connection fails', async () => {
    server.use(http.get('*/pulp/api/v3/login/', () => HttpResponse.error()));

    renderWithProviders(<Routed />, { route: PROTECTED_PATH });

    expect(
      await screen.findByRole('heading', {
        name: 'The session could not be checked',
      }),
    ).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${PROTECTED_PATH}$`),
    );
  });

  it('Retry asks the server again and opens the screen when the session is there', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(<Routed />, { route: PROTECTED_PATH });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    await screen.findByRole('heading', {
      name: 'The session could not be checked',
    });
    server.use(listOf('/pulp/api/v3/signing-services/', []).handler);
    signIn();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
  });

  it('Retry goes to the login page when the server then says nobody is signed in', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );
    const { user } = renderWithProviders(<Routed />, { route: PROTECTED_PATH });
    await screen.findByRole('heading', {
      name: 'The session could not be checked',
    });
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'No.' }, { status: 401 }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
  });

  it('a screen that needs no session renders as for a visitor while the check could not be answered', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'down' }, { status: 500 }),
      ),
    );

    renderWithProviders(<Routed />, { route: '/login' });

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
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

    it('a signed-in answer opens the screen without a redirect', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      server.use(listOf('/pulp/api/v3/signing-services/', []).handler);
      signIn();
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, { route: PROTECTED_PATH });

      expect(
        await screen.findByRole('heading', { name: 'Signature keys' }),
      ).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
    });

    it('a failed session check of 500 sends no redirect and offers Retry', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      server.use(
        http.get('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ detail: 'down' }, { status: 500 }),
        ),
      );
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, { route: PROTECTED_PATH });

      expect(
        await screen.findByRole('heading', {
          name: 'The session could not be checked',
        }),
      ).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replace).not.toHaveBeenCalled();
      expect(window.sessionStorage.getItem('pulp-ui-external-login-at')).toBe(
        null,
      );
    });

    it('a signed-out answer redirects once and remembers the time', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);
      const before = Date.now();

      renderWithProviders(<Routed />, { route: PROTECTED_PATH });

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replace).toHaveBeenCalledTimes(1);
      const stored = Number(
        window.sessionStorage.getItem('pulp-ui-external-login-at'),
      );
      expect(stored).toBeGreaterThanOrEqual(before);
      expect(stored).toBeLessThanOrEqual(Date.now());
    });

    it('a page that returns without a session within 30 seconds shows that sign-in did not complete and does not redirect again', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      window.sessionStorage.setItem(
        'pulp-ui-external-login-at',
        String(Date.now() - 5000),
      );
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, { route: PROTECTED_PATH });

      expect(
        await screen.findByRole('heading', {
          name: 'Sign-in did not complete',
        }),
      ).toBeVisible();
      expect(
        screen.getByText(
          'The login page returned without a signed-in session.',
        ),
      ).toBeVisible();
      expect(screen.getByRole('status')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Login' })).toHaveAttribute(
        'href',
        `https://login.example/start?next=${encodeURIComponent('/ui/signature-keys')}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(replace).not.toHaveBeenCalled();
    });

    it('a page that returns without a session after 40 seconds redirects again', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      window.sessionStorage.setItem(
        'pulp-ui-external-login-at',
        String(Date.now() - 40000),
      );
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, { route: PROTECTED_PATH });

      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('Sign-in did not complete')).toBeNull();
    });

    it('a screen that needs no session shows no redirect and no loop notice', async () => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
      window.sessionStorage.setItem(
        'pulp-ui-external-login-at',
        String(Date.now() - 5000),
      );
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);

      renderWithProviders(<Routed />, { route: '/login' });

      expect(await screen.findByLabelText(/username/i)).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
      expect(screen.queryByText('Sign-in did not complete')).toBeNull();
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
    http.get('*/pulp/api/v3/users/1/', () =>
      HttpResponse.json({ id: 1, is_staff: true, groups: [] }),
    ),
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

// The requests that are not the configuration file, the one shared read of the
// installed plugins or the shared reads of the signed-in user's permissions
// (their own record and roles), which every page makes.
function ownRequests(paths: string[]) {
  return paths.filter(
    (path) =>
      !path.endsWith('/pulp-ui-config.json') &&
      !path.endsWith('/pulp/api/v3/status/') &&
      !/\/pulp\/api\/v3\/users\/1\/(roles\/)?$/.test(path),
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

// Answers status/ with a failure for the first reads (the quiet second attempt
// of the plugin provider is the second one) and the given plugins afterwards,
// and counts the requests.
function failStatus(failures: number, afterwards: string[]) {
  const counter = { requests: 0 };
  server.use(
    http.get('*/pulp/api/v3/status/', () => {
      counter.requests += 1;
      if (counter.requests <= failures) {
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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('a failed status shows the loading page during the quiet second attempt and the error state only after it, never not installed, and Retry asks again', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = failStatus(2, ALL_PLUGINS);
    renderWithProviders(<Routed />, { route: '/ansible/collections' });

    await settle(2999);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(
      screen.queryByText('The plugin list could not be loaded'),
    ).not.toBeInTheDocument();
    expect(counter.requests).toBe(1);

    await settle(1);

    expect(
      screen.getByText('The plugin list could not be loaded'),
    ).toBeVisible();
    expect(screen.queryByText(/is not installed/)).not.toBeInTheDocument();
    expect(counter.requests).toBe(2);

    vi.useRealTimers();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Collections', level: 1 }),
    ).toBeVisible();
    expect(counter.requests).toBe(3);
    expect(
      screen.queryByText('The plugin list could not be loaded'),
    ).not.toBeInTheDocument();
  });

  it('Retry reports the plugin as not installed once the server answers without it', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    failStatus(2, WITHOUT_CONTAINER);
    renderWithProviders(<Routed />, { route: '/container/containers' });
    await settle(3000);
    vi.useRealTimers();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Retry' }));

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
      screen.queryByText('The plugin list could not be loaded'),
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

describe('the permission read after a failure', () => {
  function Navigate() {
    const navigate = useNavigate();
    return (
      <>
        <button type='button' onClick={() => navigate('/ansible/namespaces')}>
          Go to namespaces
        </button>
        <button type='button' onClick={() => navigate('/search')}>
          Go to search
        </button>
      </>
    );
  }

  const pause = () => act(() => new Promise((r) => setTimeout(r, 120)));

  const ownRecordReads = (requests: string[]) =>
    requests.filter((request) => request === '/pulp/api/v3/users/7/').length;

  afterEach(() => {
    server.events.removeAllListeners();
  });

  it('is repeated once on the next route change, and not again once it succeeded', async () => {
    const { requests } = servePermissions({
      own: [['file.sync_filerepository']],
    });
    let failing = true;
    server.use(
      http.get('*/pulp/api/v3/users/7/roles/', () =>
        failing
          ? HttpResponse.json({ detail: 'no' }, { status: 500 })
          : HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: [{ permissions: ['file.sync_filerepository'] }],
            }),
      ),
    );
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Navigate />
        <Routed />
      </>,
      { route: '/search' },
    );

    await screen.findByRole('heading', { name: 'Search', level: 1 });
    await waitFor(() => expect(ownRecordReads(requests)).toBe(1));
    await pause();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Go to namespaces' }));
    await waitFor(() => expect(ownRecordReads(requests)).toBe(2));
    await pause();

    await user.click(screen.getByRole('button', { name: 'Go to search' }));
    await pause();
    expect(ownRecordReads(requests)).toBe(2);
  });

  it('is not repeated on a route change when nothing failed', async () => {
    const { requests } = servePermissions({ isStaff: true });
    const user = userEvent.setup();
    renderWithProviders(
      <>
        <Navigate />
        <Routed />
      </>,
      { route: '/search' },
    );

    await screen.findByRole('heading', { name: 'Search', level: 1 });
    await waitFor(() => expect(ownRecordReads(requests)).toBe(1));
    await user.click(screen.getByRole('button', { name: 'Go to namespaces' }));
    await pause();

    expect(ownRecordReads(requests)).toBe(1);
  });
});

describe('administration screens', () => {
  // The screens read the app context, which the root route supplies.
  const RoutedInApp = () => (
    <AppContextProvider>
      <Routed />
    </AppContextProvider>
  );

  const API = '/pulp/api/v3';
  const refusal = () =>
    document.querySelector('[data-cy=InsufficientPermissions]');

  afterEach(() => {
    server.events.removeAllListeners();
  });

  // The server answers the lists the three screens read.
  function serveLists() {
    server.use(
      listOf(`${API}/users/`, []).handler,
      listOf(`${API}/groups/`, []).handler,
      listOf(`${API}/roles/`, []).handler,
    );
  }

  const SCREENS = [
    ['users list', '/users', 'Users'],
    ['groups list', '/groups', 'Groups'],
    ['roles list', '/roles', 'Roles'],
    ['user detail', '/users/detail/5', 'Users'],
    ['user edit', '/users/edit/5', 'Users'],
    ['user create', '/users/create', 'Users'],
    ['group detail', '/groups/detail/5', 'Groups'],
    ['role edit', '/roles/edit/some-role', 'Roles'],
    ['role create', '/roles/create', 'Roles'],
  ] as const;

  it.each(SCREENS)(
    'the %s page shows the insufficient permissions page without server text to a user who may not view it',
    async (_name, route) => {
      serveLists();
      servePermissions({ own: [['file.view_filerepository']] });
      const requests = recordRequests();

      renderWithProviders(<RoutedInApp />, { route });

      await waitFor(() => expect(refusal()).not.toBeNull());
      expect(
        screen.getByRole('heading', { name: 'Insufficient permissions' }),
      ).toBeVisible();
      expect(
        screen.getByText('You do not have permission to view this page.'),
      ).toBeVisible();
      expect(refusal()?.querySelectorAll('.pulp-break-anywhere')).toHaveLength(
        0,
      );

      // Only the shared reads of the signed-in user's own permissions ran.
      expect(
        requests.paths.filter(
          (path) =>
            !path.endsWith('/pulp-ui-config.json') &&
            !path.endsWith('/pulp/api/v3/status/') &&
            !path.endsWith('/pulp/api/v3/login/') &&
            !/\/pulp\/api\/v3\/users\/7\/(roles\/)?$/.test(path),
        ),
      ).toEqual([]);
      requests.stop();
    },
  );

  it('opens the roles list for staff only', async () => {
    serveLists();
    servePermissions({ isStaff: true });

    renderWithProviders(<RoutedInApp />, { route: '/roles' });

    expect(
      await screen.findByRole('heading', { name: 'Roles', level: 1 }),
    ).toBeVisible();
    expect(refusal()).toBeNull();
  });

  it('refuses the roles list to a holder of every role permission who is not staff', async () => {
    serveLists();
    servePermissions({
      own: [['core.view_role', 'core.change_role', 'core.delete_role']],
    });

    renderWithProviders(<RoutedInApp />, { route: '/roles' });

    await waitFor(() => expect(refusal()).not.toBeNull());
  });

  it('shows the loading page while the permissions are pending and sends no request of the screen', async () => {
    serveLists();
    servePermissions({ isStaff: true });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${API}/users/7/`, async () => {
        await gate;
        return HttpResponse.json({ id: 7, is_staff: true, groups: [] });
      }),
    );
    const requests = recordRequests();

    renderWithProviders(<RoutedInApp />, { route: '/users' });
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(refusal()).toBeNull();
    expect(requests.paths).not.toContain(`${API}/users/`);

    release();
    expect(
      await screen.findByRole('heading', { name: 'Users', level: 1 }),
    ).toBeVisible();
    requests.stop();
  });

  it('offers to read the permissions again, and no refusal, after the permission read failed', async () => {
    serveLists();
    servePermissions({ own: [['core.view_group']] });
    let failing = true;
    server.use(
      http.get(`*${API}/users/7/`, () =>
        failing
          ? HttpResponse.json({ detail: 'down' }, { status: 500 })
          : HttpResponse.json({
              id: 7,
              username: 'zoe',
              pulp_href: `${API}/users/7/`,
              is_staff: false,
              groups: [],
            }),
      ),
    );
    const { user } = renderWithProviders(<RoutedInApp />, { route: '/groups' });

    expect(
      await screen.findByRole('heading', {
        name: 'Your permissions could not be read',
      }),
    ).toBeVisible();
    expect(screen.getByText(/Error 500/)).toBeVisible();
    expect(refusal()).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Insufficient permissions' }),
    ).toBeNull();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('heading', { name: 'Groups', level: 1 }),
    ).toBeVisible();
    expect(refusal()).toBeNull();
  });

  it('still shows the insufficient permissions page when the permissions were read and lack the permission', async () => {
    serveLists();
    servePermissions({ own: [['file.view_filerepository']] });

    renderWithProviders(<RoutedInApp />, { route: '/groups' });

    await waitFor(() => expect(refusal()).not.toBeNull());
    expect(
      screen.queryByRole('heading', {
        name: 'Your permissions could not be read',
      }),
    ).toBeNull();
  });

  it('leaves the screens that are not administration alone', async () => {
    server.use(listOf(`${API}/signing-services/`, []).handler);
    servePermissions({ own: [] });

    renderWithProviders(<RoutedInApp />, { route: '/signature-keys' });

    expect(
      await screen.findByRole('heading', { name: 'Signature keys' }),
    ).toBeVisible();
    expect(refusal()).toBeNull();
  });
});
