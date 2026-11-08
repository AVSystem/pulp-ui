import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOf } from 'src/test-utils/pulp';
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
    // Only the session check and the configuration file are requested.
    expect(
      requests.paths.filter((path) => !path.endsWith('/pulp-ui-config.json')),
    ).toEqual(['/pulp/api/v3/login/']);
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
      expect(
        requests.paths.filter((p) => !p.endsWith('/pulp-ui-config.json')),
      ).toEqual(['/pulp/api/v3/login/']);
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
    expect(
      requests.paths.filter((p) => !p.endsWith('/pulp-ui-config.json')),
    ).toEqual(['/pulp/api/v3/login/']);
  });
});
