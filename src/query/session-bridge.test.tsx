import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { useStatus } from 'src/entities/core/status/queries';
import { reportUnauthorized } from 'src/session/session-events';
import { page } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { useUserContext } from 'src/user-context';

const answer = (version: string) => ({
  versions: [{ component: 'core', version }],
});

function StatusProbe() {
  const status = useStatus();

  if (status.isPending) {
    return <p data-testid='probe'>{status.fetchStatus}</p>;
  }
  if (status.isError) {
    return <p data-testid='probe'>failed</p>;
  }
  return <p data-testid='probe'>{status.data.versions?.[0]?.version}</p>;
}

// Mounts and unmounts the probe on demand, so a test can look at the cache
// while no screen uses it.
function Toggle({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);

  return (
    <>
      <button type='button' onClick={() => setShown(true)}>
        Show
      </button>
      <button type='button' onClick={() => setShown(false)}>
        Hide
      </button>
      {shown ? children : null}
    </>
  );
}

function Controls() {
  const { endSession, setUser } = useUserContext();

  return (
    <>
      <button type='button' onClick={() => endSession()}>
        End session
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'other', pulp_href: '/pulp/api/v3/users/2/' })
        }
      >
        Other account
      </button>
    </>
  );
}

function Screen() {
  return (
    <>
      <SignInAgain />
      <Controls />
      <Toggle>
        <StatusProbe />
      </Toggle>
    </>
  );
}

// The generated client sends no Accept header; the legacy client, which the
// plugin list still uses to read the same endpoint, always does. Only the
// reads of the query layer are of interest here.
const isQueryRead = (request: Request) => !request.headers.has('accept');

// Answers every read of the status with the version the test names and counts
// the reads of the query layer.
function serveStatus(version = '1') {
  const requests: string[] = [];
  server.use(
    http.get('*/pulp/api/v3/status/', ({ request }) => {
      if (isQueryRead(request)) {
        requests.push(request.url);
      }
      return HttpResponse.json(answer(version));
    }),
  );
  return requests;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Integration: SessionQueryBridge', { tags: ['integration'] }, () => {
  it('empties the cache when the user signs out, and a screen mounted again reads anew', async () => {
    serveSignIn();
    const requests = serveStatus();
    const { user, queryClient } = renderWithProviders(<Screen />, {
      signedIn: true,
    });
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
    expect(requests).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    await user.click(screen.getByRole('button', { name: 'End session' }));

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
    );

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('empties the cache when another account is set in memory', async () => {
    serveSignIn();
    server.use(
      http.get('*/pulp/api/v3/users/2/roles/', () =>
        HttpResponse.json(page([])),
      ),
      http.get('*/pulp/api/v3/users/2/', () =>
        HttpResponse.json({
          username: 'other',
          pulp_href: '/pulp/api/v3/users/2/',
          id: 2,
          is_staff: false,
          groups: [],
        }),
      ),
    );
    serveStatus();
    const { user, queryClient } = renderWithProviders(<Screen />, {
      signedIn: true,
    });
    await signedIn();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Hide' }));
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Other account' }));

    await waitFor(() =>
      expect(queryClient.getQueryCache().getAll()).toHaveLength(0),
    );
  });

  it('keeps the cache when nothing about the account changes', async () => {
    serveSignIn();
    serveStatus();
    const { user, queryClient } = renderWithProviders(<Screen />, {
      signedIn: true,
    });
    await signedIn();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Hide' }));
    await user.click(screen.getByRole('button', { name: 'Show' }));

    expect(await screen.findByText('1')).toBeInTheDocument();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1);
  });

  it('sends no request while the session has ended and one after the same user signs in again', async () => {
    serveSignIn();
    const requests = serveStatus();
    const { user } = renderWithProviders(<Screen />, { signedIn: true });
    await signedIn();

    act(() => reportUnauthorized('request'));
    await user.click(screen.getByRole('button', { name: 'Show' }));
    await sleep(50);

    expect(screen.getByTestId('probe')).toHaveTextContent('idle');
    expect(requests).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('1')).toBeInTheDocument();
    await sleep(50);
    expect(requests).toHaveLength(1);
  });

  it('reads a screen again when the same user signs in again, whatever it showed', async () => {
    serveSignIn();
    let version = 'before';
    const requests: string[] = [];
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        if (isQueryRead(request)) {
          requests.push(request.url);
        }
        return HttpResponse.json(answer(version));
      }),
    );
    const { user } = renderWithProviders(<Screen />, { signedIn: true });
    await signedIn();
    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(await screen.findByText('before')).toBeInTheDocument();

    version = 'after';
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('after')).toBeInTheDocument();
    expect(requests).toHaveLength(2);
  });

  it('cancels a read that is still running when the session is restored and discards its answer', async () => {
    serveSignIn();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    server.use(
      http.get('*/pulp/api/v3/status/', async ({ request }) => {
        if (!isQueryRead(request)) {
          return HttpResponse.json(answer('plugins'));
        }
        calls += 1;
        if (calls === 1) {
          // The answer of the older session arrives only after the refetch.
          await held;
          return HttpResponse.json(answer('old'));
        }
        return HttpResponse.json(answer('new'));
      }),
    );
    const { user } = renderWithProviders(<Screen />, { signedIn: true });
    await signedIn();

    await user.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(calls).toBe(1));
    expect(screen.getByTestId('probe')).toHaveTextContent('fetching');

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(await screen.findByText('new')).toBeInTheDocument();
    release();
    await sleep(100);

    expect(screen.getByTestId('probe')).toHaveTextContent('new');
    expect(screen.queryByText('old')).not.toBeInTheDocument();
    expect(calls).toBe(2);
  });
});
