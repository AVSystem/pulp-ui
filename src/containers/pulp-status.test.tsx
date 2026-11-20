import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import PulpStatus from './pulp-status';

const status = {
  versions: [{ component: 'core', version: '3.0.0' }],
  online_workers: [],
  online_api_apps: [],
  online_content_apps: [],
  database_connection: { connected: true },
  redis_connection: { connected: true },
  storage: { total: null, used: null, free: null },
  content_settings: {
    content_origin: 'https://pulp.example.com',
    content_path_prefix: '/pulp/content/',
  },
  domain_enabled: false,
};

describe('status page', () => {
  beforeEach(() => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(status)),
    );
  });

  it('names the toggle of the JSON card and reports whether it is open', async () => {
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PulpStatus />
      </AppContextProvider>,
      { route: '/status' },
    );

    const toggle = await screen.findByRole('button', { name: 'JSON' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});

const NOTE = 'Versions, workers and storage are shown to signed-in users.';
const ADMIN_NOTE =
  'Workers, storage and content settings are shown to administrators.';

function renderStatus() {
  return renderWithProviders(
    <AppContextProvider>
      <PulpStatus />
    </AppContextProvider>,
    { route: '/status' },
  );
}

const cardTitles = () =>
  Array.from(document.querySelectorAll('.pf-v6-c-card__title')).map(
    (title) => title.textContent,
  );

describe('status page for a visitor who is not signed in', () => {
  it('shows only the cards the answer holds and says what is left out', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          database_connection: { connected: true },
          redis_connection: { connected: false },
        }),
      ),
    );

    renderStatus();

    expect(await screen.findByText(NOTE)).toBeVisible();
    expect(cardTitles()).toEqual(['Database connection', 'Redis connection']);
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.getByText('Not connected')).toBeVisible();
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
  });

  it('shows no JSON toggle, so the raw answer is not shown', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          database_connection: { connected: true },
          redis_connection: { connected: true },
        }),
      ),
    );

    renderStatus();

    await screen.findByText(NOTE);
    expect(screen.queryByRole('button', { name: 'JSON' })).toBeNull();
    expect(screen.queryByText(/database_connection/)).toBeNull();
  });

  it('lines the note and the cards up with the screen title inside the section wrapper', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ database_connection: { connected: true } }),
      ),
    );

    renderStatus();

    const note = await screen.findByText(NOTE);
    const section = note.closest('section.pulp-section');
    expect(section).not.toBeNull();
    expect(section?.querySelector('.pf-v6-c-card')).not.toBeNull();
  });

  it('shows every card and no note for the full answer', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(status)),
    );

    renderStatus();

    await screen.findByRole('button', { name: 'JSON' });
    expect(cardTitles()).toEqual([
      'Versions',
      'Storage',
      'Content settings',
      'Database connection',
      'Redis connection',
      'Domain enabled',
      'Online workers',
      'Online api apps',
      'Online content apps',
      'JSON',
    ]);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe('status page with processes that are not told apart by name', () => {
  it('lists every worker and app without a key warning, and says Not connected', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const beat = '2026-01-01T00:00:00Z';
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          ...status,
          database_connection: { connected: false },
          redis_connection: { connected: false },
          online_workers: [
            { name: null, last_heartbeat: beat },
            { name: null, last_heartbeat: beat },
            { name: 'w', pulp_href: '/pulp/api/v3/workers/1/' },
          ],
          online_api_apps: [
            { name: 'api', last_heartbeat: beat },
            { name: 'api', last_heartbeat: beat },
          ],
          online_content_apps: [{ last_heartbeat: beat }],
        }),
      ),
    );

    renderStatus();

    await screen.findByRole('button', { name: 'JSON' });
    expect(screen.getAllByText('Not connected')).toHaveLength(2);
    expect(
      screen.getAllByText('Last heartbeat', { exact: false }),
    ).toHaveLength(6);
    const warned = error.mock.calls.some((call) =>
      String(call[0]).includes('unique "key"'),
    );
    error.mockRestore();
    expect(warned).toBe(false);
  });
});

describe('status page for a signed-in account that is not an administrator', () => {
  const answer = {
    versions: [{ component: 'core', version: '3.0.0' }],
    database_connection: { connected: true },
    redis_connection: { connected: true },
  };

  it('says what is left out and shows only the cards the answer holds', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(answer)),
    );

    renderStatus();

    expect(await screen.findByText(ADMIN_NOTE)).toBeVisible();
    expect(cardTitles()).toEqual([
      'Versions',
      'Database connection',
      'Redis connection',
      'JSON',
    ]);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'JSON' })).toBeVisible();
  });

  it('shows no note for an administrator, whose answer holds the workers', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(status)),
    );

    renderStatus();

    await screen.findByRole('button', { name: 'JSON' });
    expect(screen.queryByText(ADMIN_NOTE)).not.toBeInTheDocument();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });
});

describe('status page when the read fails', () => {
  it('shows an error state with Retry instead of a spinner, and reads again on Retry', async () => {
    let failing = true;
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        failing
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(status),
      ),
    );

    const { user } = renderStatus();

    expect(
      await screen.findByRole('heading', { name: 'Failed to load status' }),
    ).toBeVisible();
    expect(screen.getByText(/Error 500/)).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Versions')).toBeVisible();
    expect(screen.queryByText('Failed to load status')).toBeNull();
  });
});

describe('status page when the read is refused', () => {
  it('shows the insufficient permissions page with the reason Pulp gave, and no Retry', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      ),
    );

    renderStatus();

    expect(
      await screen.findByText('You do not have permission to view this page.'),
    ).toBeVisible();
    expect(screen.getByText('Not for you.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByText('Failed to load status')).toBeNull();
  });

  it('shows an error state, not a blank page, when the answer has the wrong shape', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ versions: [{ component: 7 }] }),
      ),
    );

    renderStatus();

    expect(await screen.findByText('Failed to load status')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});

describe('status page and the plugin list', () => {
  it('send one request to status/ between them when a signed-in account opens the screen', async () => {
    serveSignIn();
    let requests = 0;
    server.events.on('request:start', ({ request }) => {
      if (
        request.method === 'GET' &&
        new URL(request.url).pathname.endsWith('/status/')
      ) {
        requests += 1;
      }
    });
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(status)),
    );

    renderWithProviders(
      <AppContextProvider>
        <PulpStatus />
      </AppContextProvider>,
      { route: '/status', signedIn: true },
    );

    expect(await screen.findByText('Versions')).toBeVisible();
    // Give the plugin list time to read, which it does once the session check
    // has answered.
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(requests).toBe(1);
  });
});

describe('status page after the same user signs in again', () => {
  const STATUS = '*/pulp/api/v3/status/';
  const reduced = { database_connection: { connected: true } };
  const refused = http.get(STATUS, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );

  afterEach(() => {
    resetSessionEvents();
  });

  const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));
  const signInAgain = (user) =>
    user.click(screen.getByRole('button', { name: 'Sign in again' }));

  function renderSignedIn() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <PulpStatus />
      </AppContextProvider>,
      { route: '/status', signedIn: true },
    );
  }

  it('reads the status again and shows what a signed-in user may see', async () => {
    server.use(http.get(STATUS, () => HttpResponse.json(reduced)));
    const { user } = renderSignedIn();
    expect(await screen.findByText(NOTE)).toBeVisible();
    await signedIn();
    server.use(http.get(STATUS, () => HttpResponse.json(status)));

    await signInAgain(user);

    expect(await screen.findByText('Versions')).toBeVisible();
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
  });

  it('keeps its content, with no alert, when the read is refused with 401', async () => {
    server.use(http.get(STATUS, () => HttpResponse.json(status)));
    const { user } = renderSignedIn();
    await screen.findByText('Versions');
    await signedIn();
    server.use(refused);

    await signInAgain(user);
    await pause();

    expect(screen.getByText('Versions')).toBeVisible();
    expect(screen.queryByText('Failed to load status')).toBeNull();
  });

  it('keeps the spinner, with no alert, when the first read is refused, and shows the status after signing in', async () => {
    server.use(refused);
    const { user } = renderSignedIn();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Failed to load status')).toBeNull();
    server.use(http.get(STATUS, () => HttpResponse.json(status)));

    await signInAgain(user);

    expect(await screen.findByText('Versions')).toBeVisible();
  });

  it('still shows its error state when the read fails for another reason', async () => {
    server.use(
      http.get(STATUS, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderSignedIn();

    expect(await screen.findByText('Failed to load status')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  it('sends no write', async () => {
    server.use(http.get(STATUS, () => HttpResponse.json(status)));
    const recorded = recordWrites();
    const { user } = renderSignedIn();
    await screen.findByText('Versions');
    await signedIn();

    await signInAgain(user);
    await pause();

    expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
    recorded.stop();
  });
});
