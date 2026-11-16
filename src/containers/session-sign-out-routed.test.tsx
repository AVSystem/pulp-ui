import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dataRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
import { Shell } from 'src/shell/shell';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { servePermissions } from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';

// Signing out on a screen that needs no session, as the application mounts it:
// through the real route table, the real providers and the shell, against a
// server whose status answer depends on the session, as Pulp's does. What the
// screen read with the session must leave the screen with the session.

const API = '/pulp/api/v3';
const STATUS_ADDRESS = '/status';

const NOTE = 'Versions, workers and storage are shown to signed-in users.';

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
const visitor = { ...health };

type Tier = Record<string, unknown>;

// Serves the status answer of the tier while the session lasts and the visitor
// answer once the logout has ended it, and answers the logout the way the
// test says. Every status read and the logout are recorded in the order they
// reached the server.
function serveSession({
  tier = administrator,
  logout = 204,
}: { tier?: Tier; logout?: number } = {}) {
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
    http.get(`*${API}/status/`, () =>
      HttpResponse.json(sessionEnded ? visitor : tier),
    ),
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

function renderRouted(route = STATUS_ADDRESS) {
  return renderWithProviders(
    <Shell>
      <Routed />
    </Shell>,
    { route },
  );
}

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
});
