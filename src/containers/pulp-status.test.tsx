import { act, screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
    expect(cardTitles()).toEqual([
      'Database connection',
      'Redis connection',
      'JSON',
    ]);
    expect(screen.getByText('Connected')).toBeVisible();
    expect(screen.getByText('Not connected')).toBeVisible();
    expect(screen.queryByText('Not reported')).not.toBeInTheDocument();
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
      { route: '/status' },
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

  it('still shows its alert when the read fails for another reason', async () => {
    server.use(
      http.get(STATUS, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderSignedIn();

    expect(await screen.findByText('Failed to load status')).toBeVisible();
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
