import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { usePlugins } from './plugins';
import { useUserContext } from './user-context';

const LOGIN_URL = '*/pulp/api/v3/login/';

function signIn() {
  server.use(
    http.get(LOGIN_URL, () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

// Counts the requests the page sends to status/ until the test ends.
let removeCounter: () => void = () => undefined;
function countStatusRequests() {
  const counter = { requests: 0 };
  const onStart = ({ request }: { request: Request }) => {
    if (new URL(request.url).pathname.endsWith('/status/')) {
      counter.requests += 1;
    }
  };
  server.events.on('request:start', onStart);
  removeCounter = () => server.events.removeListener('request:start', onStart);
  return counter;
}

afterEach(() => removeCounter());

// Shows what the provider knows and lets a test change the session by hand.
function PluginsProbe() {
  const plugins = usePlugins();
  const { status, endSession, setUser } = useUserContext();

  return (
    <>
      <p data-testid='session'>{status}</p>
      <p data-testid='plugins'>{plugins.state}</p>
      <p data-testid='versions'>
        {plugins.state === 'ready'
          ? Array.from(plugins.versions.keys()).join(',')
          : ''}
      </p>
      <button type='button' onClick={() => endSession()}>
        End session
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' })
        }
      >
        Start session
      </button>
    </>
  );
}

describe('plugin list', () => {
  it('sends no request to status/ while nobody is signed in', async () => {
    const counter = countStatusRequests();

    renderWithProviders(<PluginsProbe />);

    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('anonymous'),
    );
    // Give a stray request time to start.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(counter.requests).toBe(0);
    expect(screen.getByTestId('plugins')).toHaveTextContent('idle');
  });

  it('is loading, with no request, until the session check has answered', async () => {
    const counter = countStatusRequests();
    server.use(
      http.get(LOGIN_URL, async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return HttpResponse.json({ detail: 'No.' }, { status: 401 });
      }),
    );

    renderWithProviders(<PluginsProbe />);

    expect(screen.getByTestId('session')).toHaveTextContent('checking');
    expect(screen.getByTestId('plugins')).toHaveTextContent('loading');
    expect(counter.requests).toBe(0);
    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('idle'),
    );
  });

  it('reads the plugin list once when someone is signed in', async () => {
    signIn();
    const counter = countStatusRequests();

    renderWithProviders(<PluginsProbe />);

    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('ready'),
    );
    expect(screen.getByTestId('versions')).toHaveTextContent('core,file');
    expect(counter.requests).toBe(1);
  });

  it('reads the plugin list again after a sign-out followed by a sign-in', async () => {
    signIn();
    const counter = countStatusRequests();

    const { user } = renderWithProviders(<PluginsProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('ready'),
    );
    expect(counter.requests).toBe(1);

    await user.click(screen.getByRole('button', { name: 'End session' }));
    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('idle'),
    );
    expect(counter.requests).toBe(1);

    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'core', version: '4.0.0' }],
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Start session' }));

    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('ready'),
    );
    expect(screen.getByTestId('versions')).toHaveTextContent(/^core$/);
    expect(counter.requests).toBe(2);
  });
});
