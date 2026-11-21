import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, isValidElement } from 'react';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericPulpAPI } from 'src/api/generic-pulp';
import { dataRoutes } from 'src/app-routes';
import { Paths, formatPath } from 'src/paths';
import { ReauthDialog } from 'src/session/reauth-dialog';
import { resetSessionEvents } from 'src/session/session-events';
import { Shell } from 'src/shell/shell';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { servePermissions } from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import { useUserContext } from 'src/user-context';

// Signing out on a screen that needs no session, as the application mounts it:
// through the real route table, the real providers and the shell, against a
// server whose status answer depends on the session, as Pulp's does. What the
// screen read with the session must leave the screen with the session.

const API = '/pulp/api/v3';
const STATUS_ADDRESS = '/status';

const NOTE = 'Versions, workers and storage are shown to signed-in users.';
const ADMIN_NOTE =
  'Workers, storage and content settings are shown to administrators.';

// The name sits in a text node beside a label, so it is looked up by pattern.
const WORKER = /worker-1@node-a/;
const ORIGIN = 'https://content.example.com';
const HEARTBEAT = '2025-01-02T03:04:05Z';

const health = {
  database_connection: { connected: true },
  redis_connection: { connected: true },
};
const versions = { versions: [{ component: 'core', version: '3.0.0' }] };

// The three tiers of the answer: everything for an administrator, the versions
// for a signed-in account that is not one, health only for everybody else.
const administrator = {
  ...versions,
  ...health,
  online_workers: [
    {
      name: 'worker-1@node-a',
      current_task: null,
      last_heartbeat: HEARTBEAT,
      pulp_created: HEARTBEAT,
      pulp_last_updated: HEARTBEAT,
    },
  ],
  online_api_apps: [{ name: 'api-1@node-a', last_heartbeat: HEARTBEAT }],
  online_content_apps: [
    { name: 'content-1@node-a', last_heartbeat: HEARTBEAT },
  ],
  storage: { total: 1000, used: 100, free: 900 },
  content_settings: {
    content_origin: ORIGIN,
    content_path_prefix: '/pulp/content/',
  },
  domain_enabled: false,
};
const account = { ...versions, ...health };
const visitor = { ...health };

type Tier = Record<string, unknown>;

// Serves the status answer of the tier while the session lasts and the visitor
// answer once the logout has ended it, and answers the logout the way the
// test says. Every status read and the logout are recorded in the order they
// reached the server. A read that starts while the session lasts waits for
// hold when it is given and then still answers the tier, as a slow answer
// does that was produced before the session ended.
function serveSession({
  tier = administrator,
  logout = 204,
  hold,
}: { tier?: Tier; logout?: number; hold?: Promise<void> } = {}) {
  let sessionEnded = false;
  const sent: string[] = [];

  server.events.on('request:start', ({ request }) => {
    const { pathname } = new URL(request.url);
    if (pathname === `${API}/status/` || pathname === `${API}/login/`) {
      if (request.method === 'GET' && pathname === `${API}/login/`) {
        return;
      }
      sent.push(`${request.method} ${pathname}`);
    }
  });

  server.use(
    http.delete(`*${API}/login/`, () => {
      if (logout === 204) {
        sessionEnded = true;
        return new HttpResponse(null, { status: 204 });
      }
      if (logout === 401) {
        sessionEnded = true;
      }
      return HttpResponse.json({ detail: 'Refused.' }, { status: logout });
    }),
    http.get(`*${API}/status/`, async () => {
      const endedAtStart = sessionEnded;
      if (!endedAtStart && hold) {
        await hold;
      }
      return HttpResponse.json(endedAtStart ? visitor : tier);
    }),
  );

  return {
    sent,
    // The status reads that were sent after the logout reached the server.
    readsAfterLogout: () =>
      sent
        .slice(sent.indexOf('DELETE /pulp/api/v3/login/') + 1)
        .filter((entry) => entry === 'GET /pulp/api/v3/status/'),
  };
}

const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

function Routed() {
  const { pathname } = useLocation();
  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardedRoutes)}
    </>
  );
}

function renderRouted(route = STATUS_ADDRESS, extra?: ReactNode) {
  return renderWithProviders(
    <>
      <Shell>
        <Routed />
      </Shell>
      {extra}
    </>,
    { route },
  );
}

// The first level-1 heading inside the main container: the screen's own.
const screenHeading = async () => {
  const [heading] = await within(screen.getByRole('main')).findAllByRole(
    'heading',
    { level: 1 },
  );
  return heading as HTMLElement;
};

// Shows how often the signed-in account went away.
function GenerationProbe() {
  const { generation } = useUserContext();
  return <p data-testid='generation'>{generation}</p>;
}

const settle = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

// Presses Logout in the account menu.
async function pressLogout(user: ReturnType<typeof renderRouted>['user']) {
  const toggle = await waitFor(() => {
    const element = document.querySelector<HTMLElement>(
      'button[data-cy=user-dropdown]',
    );
    expect(element).not.toBeNull();
    return element as HTMLElement;
  });
  await user.click(toggle);
  await user.click(await screen.findByRole('menuitem', { name: /^logout$/i }));
}

const cardTitles = () =>
  Array.from(document.querySelectorAll('.pf-v6-c-card__title')).map(
    (title) => title.textContent,
  );

// Nothing a signed-in tier added to the health answer is in the document.
function expectNothingOfTheSession() {
  expect(screen.queryByText(WORKER)).not.toBeInTheDocument();
  expect(screen.queryByText(ORIGIN)).not.toBeInTheDocument();
  expect(screen.queryByText('Storage')).not.toBeInTheDocument();
  expect(screen.queryByText('Versions')).not.toBeInTheDocument();
  expect(
    screen.queryByText('core', { selector: 'td' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'JSON' }),
  ).not.toBeInTheDocument();
}

beforeEach(() => {
  setPageUrl('https://pulp.example.com/ui/');
  setPageWidth(1400);
});

afterEach(() => {
  resetPageWidth();
  resetSessionEvents();
  server.events.removeAllListeners();
  config.UI_EXTERNAL_LOGIN_URI = null;
  vi.restoreAllMocks();
});

describe('signing out on the status screen with the built-in login', () => {
  it('reads the status again without the session and shows only the visitor answer', async () => {
    servePermissions({ isStaff: true });
    const session = serveSession();
    const { user } = renderRouted();
    expect(await screen.findByText(WORKER)).toBeVisible();
    expect(screen.getByText(ORIGIN)).toBeVisible();

    await pressLogout(user);

    expect(await screen.findByText(NOTE)).toBeVisible();
    expectNothingOfTheSession();
    expect(cardTitles()).toEqual(['Database connection', 'Redis connection']);
    expect(session.readsAfterLogout()).toHaveLength(1);
    expect(screen.getByTestId('location')).toHaveTextContent(
      new RegExp(`^${STATUS_ADDRESS}/?$`),
    );
  });

  it('does the same for an account that is not an administrator', async () => {
    servePermissions({ isStaff: false });
    const session = serveSession({ tier: account });
    const { user } = renderRouted();
    expect(await screen.findByText(ADMIN_NOTE)).toBeVisible();
    expect(screen.getByText('Versions')).toBeVisible();
    expect(screen.getByText('core', { selector: 'td' })).toBeVisible();

    await pressLogout(user);

    expect(await screen.findByText(NOTE)).toBeVisible();
    expectNothingOfTheSession();
    expect(screen.queryByText(ADMIN_NOTE)).not.toBeInTheDocument();
    expect(session.readsAfterLogout()).toHaveLength(1);
  });

  it('does the same when the logout is answered 401 because the session was already gone', async () => {
    servePermissions({ isStaff: true });
    const session = serveSession({ logout: 401 });
    const { user } = renderRouted();
    expect(await screen.findByText(WORKER)).toBeVisible();

    await pressLogout(user);

    expect(await screen.findByText(NOTE)).toBeVisible();
    expectNothingOfTheSession();
    expect(session.readsAfterLogout()).toHaveLength(1);
    expect(screen.queryByText('Sign-out did not complete')).toBeNull();
  });

  it.each([403, 500])(
    'keeps the user signed in and the screen as it is when the logout is answered %s',
    async (logout) => {
      servePermissions({ isStaff: true });
      const session = serveSession({ logout });
      const { user } = renderRouted();
      expect(await screen.findByText(WORKER)).toBeVisible();
      const heading = await screenHeading();

      await pressLogout(user);

      expect(
        await screen.findByText('Sign-out did not complete'),
      ).toBeVisible();
      expect(screen.getByText(/You are still signed in\./)).toBeVisible();
      await settle();
      expect(screen.getByText(WORKER)).toBeVisible();
      expect(screen.getByText(ORIGIN)).toBeVisible();
      expect(heading.isConnected).toBe(true);
      expect(session.readsAfterLogout()).toHaveLength(0);
      expect(
        document.querySelector('button[data-cy=user-dropdown]'),
      ).not.toBeNull();
    },
  );

  it('drops a status answer that arrives after the sign-out', async () => {
    servePermissions({ isStaff: true });
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const session = serveSession({ hold });
    const { user } = renderRouted(STATUS_ADDRESS, <GenerationProbe />);
    await screen.findByRole('progressbar');
    const heading = await screenHeading();
    expect(screen.getByTestId('generation')).toHaveTextContent('0');

    await pressLogout(user);
    expect(await screen.findByText(NOTE)).toBeVisible();
    expect(session.readsAfterLogout()).toHaveLength(1);

    // the read of the ended session answers now, with the full tier
    release();
    await settle();

    expectNothingOfTheSession();
    expect(screen.getByText(NOTE)).toBeVisible();
    // the screen was mounted afresh by the sign-out, which is why the late
    // answer reached nobody
    expect(screen.getByTestId('generation')).toHaveTextContent('1');
    expect(heading.isConnected).toBe(false);
  });
});

describe('signing in again as the same account on the status screen', () => {
  function Probes() {
    const { status, generation } = useUserContext();
    return (
      <>
        <p data-testid='session'>{status}</p>
        <p data-testid='generation'>{generation}</p>
        <button
          type='button'
          onClick={() => GenericPulpAPI.get('users/4/').catch(() => undefined)}
        >
          Probe request
        </button>
      </>
    );
  }

  it('keeps the screen mounted and reads the status once more', async () => {
    servePermissions({ isStaff: true });
    serveSession();
    const { user } = renderRouted(
      STATUS_ADDRESS,
      <>
        <Probes />
        <ReauthDialog />
      </>,
    );
    expect(await screen.findByText(WORKER)).toBeVisible();
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('authenticated'),
    );
    const heading = await screenHeading();

    // a request is refused: the session has ended
    server.use(
      http.get(`*${API}/users/4/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Probe request' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });

    // the account comes back and the status now names another worker
    server.use(
      http.get(`*${API}/status/`, () =>
        HttpResponse.json({
          ...administrator,
          online_workers: [
            { ...administrator.online_workers[0], name: 'worker-2@node-b' },
          ],
        }),
      ),
    );
    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText(/worker-2@node-b/)).toBeVisible();
    expect(screen.queryByText(WORKER)).not.toBeInTheDocument();
    expect(heading.isConnected).toBe(true);
    expect(await screenHeading()).toBe(heading);
    expect(screen.getByTestId('generation')).toHaveTextContent('0');
  });
});

describe('signing out on the status screen with an external login address', () => {
  it('still lands on the signed out page', async () => {
    config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
    const replace = vi
      .spyOn(window.location, 'replace')
      .mockImplementation(() => undefined);
    servePermissions({ isStaff: true });
    serveSession();
    const { user } = renderRouted();
    expect(await screen.findByText(WORKER)).toBeVisible();

    await pressLogout(user);

    expect(
      await screen.findByText('You have been signed out of Pulp.'),
    ).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(
      /^\/signed-out\/?$/,
    );
    expectNothingOfTheSession();
    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

// Every screen that needs no session and can be shown to a signed-in user. The
// list is read from the route table, so a screen added later is checked too.
// The sign-in page is left out because a signed-in user is sent on from it, and
// the signed out page because it never holds a user.
const screensWithoutSession = guardedRoutes
  .filter(
    (route) =>
      isValidElement<{ noAuth?: boolean }>(route.element) &&
      Boolean(route.element.props.noAuth),
  )
  .map((route) => route.path as string)
  .filter((path) => path !== Paths.meta.login && path !== Paths.meta.signedOut);

describe('every screen that needs no session', () => {
  it('is found in the route table', () => {
    expect(screensWithoutSession).toContain(Paths.core.status);
  });

  it.each(screensWithoutSession)(
    'is mounted afresh when the user signs out of %s',
    async (path) => {
      servePermissions({ isStaff: true });
      serveSession();
      const { user } = renderRouted(formatPath(path));
      const heading = await screenHeading();

      await pressLogout(user);

      await waitFor(() => expect(heading.isConnected).toBe(false));
      expect(await screenHeading()).not.toBe(heading);
    },
  );
});
