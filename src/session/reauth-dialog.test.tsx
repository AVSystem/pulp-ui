import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { PulpAPI } from 'src/api/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { useSessionEpoch, useUserContext } from 'src/user-context';
import { ReauthDialog } from './reauth-dialog';
import { resetSessionEvents } from './session-events';

const LOGIN_URL = '*/pulp/api/v3/login/';
const EXAMPLES_URL = '*/pulp/api/v3/examples/';

const examples = new PulpAPI();

// A screen that reads from the API on a button press and shows the epoch.
function Screen() {
  const epoch = useSessionEpoch();
  const { status } = useUserContext();
  const read = () => examples.http.get('examples/').catch(() => undefined);

  return (
    <>
      <p data-testid='status'>{status}</p>
      <p data-testid='epoch'>{epoch}</p>
      <button type='button' onClick={read}>
        Read
      </button>
      <button
        type='button'
        onClick={() => {
          read();
          read();
          read();
        }}
      >
        Read three times
      </button>
      <input aria-label='Draft' defaultValue='' />
    </>
  );
}

function signedInAs(username = 'zoe', href = '/pulp/api/v3/users/1/') {
  server.use(
    http.get(LOGIN_URL, () => HttpResponse.json({ username, pulp_href: href })),
  );
}

// Counts what the server saw for each method and path.
function countRequests() {
  const counts: Record<string, number> = {};
  server.events.on('request:start', ({ request }) => {
    const key = `${request.method} ${new URL(request.url).pathname}`;
    counts[key] = (counts[key] ?? 0) + 1;
  });
  return counts;
}

function refuseExamples() {
  server.use(
    http.get(EXAMPLES_URL, () =>
      HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
    ),
  );
}

async function renderScreen() {
  signedInAs();
  refuseExamples();
  const rendered = renderWithProviders(
    <>
      <Screen />
      <ReauthDialog />
    </>,
  );
  // The session check has answered once the user is known.
  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
  );
  return rendered;
}

afterEach(() => {
  resetSessionEvents();
  server.events.removeAllListeners();
});

describe('sign in again dialog', () => {
  it('shows no dialog while nobody is signed in, even after a refused request', async () => {
    refuseExamples();
    const { user } = renderWithProviders(
      <>
        <Screen />
        <ReauthDialog />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Read' }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a refused request of a signed-in user opens the dialog named Sign in again', async () => {
    const { user } = await renderScreen();

    await user.click(screen.getByRole('button', { name: 'Read' }));

    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    expect(
      within(dialog).getByText('Your session has ended. Log in to continue.'),
    ).toBeVisible();
  });

  it('three refused requests at once open one dialog', async () => {
    const { user } = await renderScreen();

    await user.click(screen.getByRole('button', { name: 'Read three times' }));

    await screen.findByRole('dialog', { name: /Sign in again/ });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('signing in again as the same user sends one login request with a Basic header, closes the dialog and moves the epoch to 1', async () => {
    const { user } = await renderScreen();
    const posts: (string | null)[] = [];
    server.use(
      http.post(LOGIN_URL, ({ request }) => {
        posts.push(request.headers.get('authorization'));
        return HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        );
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });

    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sign in again/ }),
      ).not.toBeInTheDocument(),
    );
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatch(/^Basic /);
    expect(
      Buffer.from((posts[0] ?? '').slice('Basic '.length), 'base64').toString(
        'utf8',
      ),
    ).toBe('zoe:secret');
    expect(screen.getByTestId('epoch')).toHaveTextContent('1');
  });

  it('the refused request is not sent again after signing in', async () => {
    const requests = countRequests();
    const { user } = await renderScreen();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('epoch')).toHaveTextContent('1'),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(requests['GET /pulp/api/v3/examples/']).toBe(1);
  });

  it('keeps what the user typed on the screen behind the dialog', async () => {
    const { user } = await renderScreen();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );
    await user.type(screen.getByLabelText('Draft'), 'unsaved words');
    await user.click(screen.getByRole('button', { name: 'Read' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });
    await user.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await user.click(within(dialog).getByRole('button', { name: 'Log in' }));
    await waitFor(() =>
      expect(screen.getByTestId('epoch')).toHaveTextContent('1'),
    );

    expect(screen.getByLabelText('Draft')).toHaveValue('unsaved words');
  });
});
