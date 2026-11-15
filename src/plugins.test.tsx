import { fireEvent, screen, waitFor } from '@testing-library/react';
import { HttpResponse, delay, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { settle } from 'src/test-utils/settle';
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

afterEach(() => {
  removeCounter();
  vi.useRealTimers();
});

// Every state the probe was rendered with, in order.
const renderedStates: string[] = [];

// Shows what the provider knows and lets a test change the session by hand.
function PluginsProbe() {
  const plugins = usePlugins();
  renderedStates.push(plugins.state);
  const { status, endSession, setUser, signInAgain } = useUserContext();

  return (
    <>
      <p data-testid='session'>{status}</p>
      <p data-testid='plugins'>{plugins.state}</p>
      <p data-testid='versions'>
        {plugins.state === 'ready'
          ? Array.from(plugins.versions.keys()).join(',')
          : ''}
      </p>
      <button type='button' onClick={plugins.retry}>
        Retry plugins
      </button>
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
      <button type='button' onClick={() => signInAgain('zoe', 'secret')}>
        Sign in again
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

describe('plugin list after the same user signs in again', () => {
  it('reads the plugin list again and shows the fresh answer without going back to loading', async () => {
    signIn();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );
    const counter = countStatusRequests();
    const { user } = renderWithProviders(<PluginsProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins')).toHaveTextContent('ready'),
    );
    expect(counter.requests).toBe(1);
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        // Slow enough for a loading state, if there were one, to be drawn.
        await delay(100);
        return HttpResponse.json({
          versions: [
            { component: 'core', version: '3.0.0' },
            { component: 'rpm', version: '3.0.0' },
          ],
        });
      }),
    );
    renderedStates.length = 0;

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() =>
      expect(screen.getByTestId('versions')).toHaveTextContent('core,rpm'),
    );
    expect(counter.requests).toBe(2);
    expect(renderedStates).not.toContain('loading');
    expect(renderedStates).toContain('ready');
  });
});

// Answers status/ with the given outcomes in turn (the last one repeats) and
// counts the requests.
function answerPlugins(...outcomes: ('fail' | 'ok')[]) {
  const counter = { requests: 0 };
  server.use(
    http.get('*/pulp/api/v3/status/', () => {
      const outcome = outcomes[Math.min(counter.requests, outcomes.length - 1)];
      counter.requests += 1;
      return outcome === 'ok'
        ? HttpResponse.json({
            versions: [{ component: 'core', version: '3.0.0' }],
          })
        : HttpResponse.json({ detail: 'Failed.' }, { status: 500 });
    }),
  );
  return counter;
}

const showsState = (state: string) =>
  expect(screen.getByTestId('plugins')).toHaveTextContent(state);

describe('plugin list retry', () => {
  it('stays as loading after the first failed read and reads once more after 3000 ms', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');

    renderWithProviders(<PluginsProbe />);
    await settle();
    expect(counter.requests).toBe(1);
    showsState('loading');

    await settle(2999);
    expect(counter.requests).toBe(1);
    showsState('loading');

    await settle(1);
    expect(counter.requests).toBe(2);
  });

  it('is ready when the second read succeeds', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail', 'ok');

    renderWithProviders(<PluginsProbe />);
    await settle(3000);

    showsState('ready');
    expect(counter.requests).toBe(2);
  });

  it('is in error only when the second read fails, and then makes no further attempt', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');

    renderWithProviders(<PluginsProbe />);
    await settle(3000);

    showsState('error');
    await settle(60000);
    expect(counter.requests).toBe(2);
  });

  it('turns a status answer without versions into an error state', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let requests = 0;
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        requests += 1;
        return HttpResponse.json({ database_connection: { connected: true } });
      }),
    );

    renderWithProviders(<PluginsProbe />);
    await settle(3000);

    showsState('error');
    expect(requests).toBe(2);
  });

  it('reads once and without an automatic second attempt when the user asks again and it fails', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');

    renderWithProviders(<PluginsProbe />);
    await settle(3000);
    showsState('error');

    fireEvent.click(screen.getByRole('button', { name: 'Retry plugins' }));
    await settle();
    expect(counter.requests).toBe(3);
    showsState('error');
    await settle(60000);
    expect(counter.requests).toBe(3);
  });

  it('cancels the wait when the session ends, so no request is sent for the old session', async () => {
    signIn();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const counter = answerPlugins('fail');

    renderWithProviders(<PluginsProbe />);
    await settle();
    expect(counter.requests).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'End session' }));
    await settle(10000);

    expect(counter.requests).toBe(1);
    showsState('idle');
  });
});
