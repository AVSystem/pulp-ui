import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSuspended,
  reportUnauthorized,
  resetSessionEvents,
} from 'src/session/session-events';
import { setPageUrl } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { blockStorage } from 'src/test-utils/storage';
import { useUserContext } from './user-context';

const LOGIN_URL = '*/pulp/api/v3/login/';

// Shows the session state and offers a logout button that reports how the
// logout promise ended.
function SessionProbe() {
  const {
    status,
    user,
    logout,
    retrySessionCheck,
    generation,
    epoch,
    endSession,
    signInAgain,
    restoreSession,
    setUser,
  } = useUserContext();
  const [outcome, setOutcome] = useState('none');
  const [restored, setRestored] = useState('never');

  return (
    <>
      <p data-testid='status'>{status}</p>
      <p data-testid='user'>{user?.username ?? 'nobody'}</p>
      <p data-testid='outcome'>{outcome}</p>
      <p data-testid='generation'>{generation}</p>
      <p data-testid='epoch'>{epoch}</p>
      <p data-testid='restored'>{restored}</p>
      <button
        type='button'
        onClick={() =>
          setRestored(
            String(
              restoreSession({
                username: 'zoe',
                pulp_href: '/pulp/api/v3/users/1/',
              }),
            ),
          )
        }
      >
        Restore the session
      </button>
      <button
        type='button'
        onClick={() =>
          setRestored(
            String(
              restoreSession({
                username: 'ann',
                pulp_href: '/pulp/api/v3/users/2/',
              }),
            ),
          )
        }
      >
        Restore as another account
      </button>
      <button type='button' onClick={() => endSession('password-changed')}>
        End session
      </button>
      <button type='button' onClick={() => signInAgain('zoe', 'secret')}>
        Sign in again
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'ann', pulp_href: '/pulp/api/v3/users/2/' })
        }
      >
        Switch account
      </button>
      <button
        type='button'
        onClick={() =>
          logout().then(
            () => setOutcome('resolved'),
            (error: Error) => setOutcome(`rejected: ${error.message}`),
          )
        }
      >
        Sign out
      </button>
      <button type='button' onClick={() => retrySessionCheck()}>
        Check again
      </button>
    </>
  );
}

// Takes marks of the session and reports whether each is still current, both
// through the latest context function and through a copy captured at the first
// render, as a listener bound once would hold.
function MarkProbe() {
  const { sessionMark, isCurrentSession, setUser } = useUserContext();
  const firstCopy = useRef(isCurrentSession);
  const taken = useRef<ReturnType<typeof sessionMark> | null>(null);
  const [current, setCurrent] = useState('untaken');
  const [currentByCopy, setCurrentByCopy] = useState('untaken');
  const [ended, setEnded] = useState('untaken');
  const [generationOfMark, setGenerationOfMark] = useState('untaken');

  return (
    <>
      <p data-testid='mark-current'>{current}</p>
      <p data-testid='mark-current-by-copy'>{currentByCopy}</p>
      <p data-testid='mark-ended'>{ended}</p>
      <p data-testid='mark-generation'>{generationOfMark}</p>
      <button
        type='button'
        onClick={() => {
          taken.current = sessionMark();
          setEnded(String(taken.current.ended));
          setGenerationOfMark(String(taken.current.generation));
        }}
      >
        Take a mark
      </button>
      <button
        type='button'
        onClick={() => {
          setCurrent(String(isCurrentSession(taken.current)));
          setCurrentByCopy(String(firstCopy.current(taken.current)));
        }}
      >
        Ask about the mark
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' })
        }
      >
        Sign in as the same account
      </button>
    </>
  );
}

// Starts the provider with the server reporting someone signed in.
async function renderSignedIn() {
  server.use(
    http.get(LOGIN_URL, () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
  const rendered = renderWithProviders(<SessionProbe />);
  await waitFor(() =>
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
  );
  return rendered;
}

describe('user context', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('still starts and asks who is signed in when the browser storage is blocked', async () => {
    blockStorage();

    await renderSignedIn();

    expect(screen.getByTestId('user')).toHaveTextContent('zoe');
  });

  it('on start it removes the legacy credentials keys from both storages without reading them and asks who is signed in', async () => {
    window.localStorage.setItem('credentials', 'legacy-local-value');
    window.sessionStorage.setItem('credentials', 'legacy-session-value');
    const removed = [window.localStorage, window.sessionStorage].map(
      (storage) => vi.spyOn(storage, 'removeItem'),
    );

    const asked: string[] = [];
    server.use(
      http.get(LOGIN_URL, ({ request }) => {
        asked.push(`${request.method} ${new URL(request.url).pathname}`);
        return HttpResponse.json(
          { detail: 'Not authenticated.' },
          { status: 401 },
        );
      }),
    );

    renderWithProviders(<SessionProbe />);

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );

    expect(window.localStorage.getItem('credentials')).toBeNull();
    expect(window.sessionStorage.getItem('credentials')).toBeNull();
    for (const spy of removed) {
      expect(spy).toHaveBeenCalledWith('credentials');
    }
    expect(asked).toEqual(['GET /pulp/api/v3/login/']);
  });

  it('on start it never reads the legacy credentials key', async () => {
    window.localStorage.setItem('credentials', 'legacy-local-value');
    window.sessionStorage.setItem('credentials', 'legacy-session-value');
    // The spies sit on the storage objects themselves, because the
    // environment does not route calls through the Storage prototype.
    const reads = [window.localStorage, window.sessionStorage].map((storage) =>
      vi.spyOn(storage, 'getItem'),
    );

    renderWithProviders(<SessionProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).not.toHaveTextContent('checking'),
    );

    for (const spy of reads) {
      expect(spy.mock.calls.map(([key]) => key)).not.toContain('credentials');
    }
  });

  it('a signed-in answer from the server makes the user authenticated', async () => {
    await renderSignedIn();

    expect(screen.getByTestId('user')).toHaveTextContent('zoe');
  });

  it('logout answered 204 ends signed out', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () => new HttpResponse(null, { status: 204 })),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );
    expect(screen.getByTestId('outcome')).toHaveTextContent('resolved');
    expect(screen.getByTestId('user')).toHaveTextContent('nobody');
  });

  it('logout answered 401 ends signed out without a rejection', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () =>
        HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );
    expect(screen.getByTestId('outcome')).toHaveTextContent('resolved');
  });

  it('logout answered 403 keeps the user signed in and rejects with the server reason', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () =>
        HttpResponse.json(
          { detail: 'CSRF Failed: token missing.' },
          { status: 403 },
        ),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByTestId('outcome')).toHaveTextContent(
        'rejected: CSRF Failed: token missing.',
      ),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('user')).toHaveTextContent('zoe');
  });

  it('logout answered 500 keeps the user signed in and rejects with the server reason', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () =>
        HttpResponse.json({ detail: 'Backend unavailable.' }, { status: 500 }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByTestId('outcome')).toHaveTextContent(
        'rejected: Backend unavailable.',
      ),
    );
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
  });
  describe('the first session check of a page load', () => {
    const answer = (status: number | 'network') =>
      server.use(
        http.get(LOGIN_URL, () =>
          status === 'network'
            ? HttpResponse.error()
            : HttpResponse.json({ detail: 'Backend unavailable.' }, { status }),
        ),
      );

    const shown = (status: string) =>
      waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent(status),
      );

    it.each([
      ['a 500 answer', 500],
      ['a 503 answer', 503],
      ['a network error', 'network'],
    ] as const)(
      '%s leaves the session unknown, not signed out',
      async (_name, status) => {
        answer(status);

        renderWithProviders(<SessionProbe />);

        await shown('unknown');
        expect(screen.getByTestId('user')).toHaveTextContent('nobody');
      },
    );

    it('a 401 answer means signed out', async () => {
      answer(401);

      renderWithProviders(<SessionProbe />);

      await shown('anonymous');
    });

    it('asking again after an unknown answer makes the user authenticated when the server answers', async () => {
      answer(500);
      const { user } = renderWithProviders(<SessionProbe />);
      await shown('unknown');
      server.use(
        http.get(LOGIN_URL, () =>
          HttpResponse.json({
            username: 'zoe',
            pulp_href: '/pulp/api/v3/users/1/',
          }),
        ),
      );

      await user.click(screen.getByRole('button', { name: 'Check again' }));

      await shown('authenticated');
      expect(screen.getByTestId('user')).toHaveTextContent('zoe');
    });

    it('asking again sends one request and shows checking while it runs', async () => {
      answer(500);
      const { user } = renderWithProviders(<SessionProbe />);
      await shown('unknown');
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const asked: string[] = [];
      server.use(
        http.get(LOGIN_URL, async ({ request }) => {
          asked.push(request.method);
          await gate;
          return HttpResponse.json({ detail: 'No.' }, { status: 401 });
        }),
      );

      await user.click(screen.getByRole('button', { name: 'Check again' }));

      await shown('checking');
      release();
      await shown('anonymous');
      expect(asked).toEqual(['GET']);
    });

    it('a signed-in answer clears the time of the last external login redirect', async () => {
      window.sessionStorage.setItem(
        'pulp-ui-external-login-at',
        String(Date.now()),
      );

      await renderSignedIn();

      expect(window.sessionStorage.getItem('pulp-ui-external-login-at')).toBe(
        null,
      );
    });

    it('a signed-out answer keeps the time of the last external login redirect', async () => {
      window.sessionStorage.setItem('pulp-ui-external-login-at', '123');
      answer(401);

      renderWithProviders(<SessionProbe />);
      await shown('anonymous');

      expect(window.sessionStorage.getItem('pulp-ui-external-login-at')).toBe(
        '123',
      );
    });
  });
  describe('on the signed out page', () => {
    afterEach(() => setPageUrl('http://localhost/'));

    it.each([
      'https://pulp.example.com/ui/signed-out',
      'https://pulp.example.com/ui/signed-out/',
    ])('%s sends no request and is anonymous', async (address) => {
      setPageUrl(address);
      const sent: string[] = [];
      server.events.on('request:start', ({ request }) => {
        sent.push(`${request.method} ${new URL(request.url).pathname}`);
      });

      renderWithProviders(<SessionProbe />);

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
      );
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(sent).toEqual([]);
      server.events.removeAllListeners();
    });

    it('another page still asks who is signed in', async () => {
      setPageUrl('https://pulp.example.com/ui/status/');

      await renderSignedIn();

      expect(screen.getByTestId('user')).toHaveTextContent('zoe');
    });
  });
});

describe('session generation', () => {
  const generation = () => screen.getByTestId('generation');
  const serveOtherAccount = () =>
    server.use(
      http.get('*/pulp/api/v3/users/2/', () =>
        HttpResponse.json({ id: 2, is_staff: true, groups: [] }),
      ),
    );
  const shown = (status: string) =>
    waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent(status),
    );

  it('starts at 0 and stays there when the first check answers a user', async () => {
    await renderSignedIn();

    expect(generation()).toHaveTextContent('0');
  });

  it('stays at 0 when the first check answers 401', async () => {
    server.use(
      http.get(LOGIN_URL, () =>
        HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
      ),
    );

    renderWithProviders(<SessionProbe />);

    await shown('anonymous');
    expect(generation()).toHaveTextContent('0');
  });

  it.each([
    ['204', () => new HttpResponse(null, { status: 204 })],
    [
      '401',
      () =>
        HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
    ],
  ])('grows by one when logout is answered %s', async (_status, answer) => {
    const { user } = await renderSignedIn();
    server.use(http.delete(LOGIN_URL, answer));

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await shown('anonymous');
    expect(generation()).toHaveTextContent('1');
  });

  it.each([
    ['403', 403],
    ['500', 500],
  ])('does not change when logout is answered %s', async (_name, code) => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () =>
        HttpResponse.json({ detail: 'Refused.' }, { status: code }),
      ),
    );

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByTestId('outcome')).toHaveTextContent('rejected'),
    );
    expect(generation()).toHaveTextContent('0');
  });

  it('grows by one when the session is ended for a changed password', async () => {
    const { user } = await renderSignedIn();

    await user.click(screen.getByRole('button', { name: 'End session' }));

    await shown('anonymous');
    expect(generation()).toHaveTextContent('1');
  });

  it('grows by one when another account takes the place of the signed-in one', async () => {
    const { user } = await renderSignedIn();
    serveOtherAccount();

    await user.click(screen.getByRole('button', { name: 'Switch account' }));

    await waitFor(() =>
      expect(screen.getByTestId('user')).toHaveTextContent('ann'),
    );
    expect(generation()).toHaveTextContent('1');
  });

  it('does not change when the same account signs in again, which grows the epoch instead', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.post(LOGIN_URL, () =>
        HttpResponse.json(
          { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' },
          { status: 201 },
        ),
      ),
    );

    await waitFor(() => expect(isSuspended()).toBe(false));
    act(() => reportUnauthorized('request'));
    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    await waitFor(() =>
      expect(screen.getByTestId('epoch')).toHaveTextContent('1'),
    );
    expect(generation()).toHaveTextContent('0');
  });

  it('grows once more when the account signs out a second time after signing in anew', async () => {
    const { user } = await renderSignedIn();
    server.use(
      http.delete(LOGIN_URL, () => new HttpResponse(null, { status: 204 })),
    );
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await shown('anonymous');
    serveOtherAccount();

    await user.click(screen.getByRole('button', { name: 'Switch account' }));
    await shown('authenticated');
    expect(generation()).toHaveTextContent('1');

    await user.click(screen.getByRole('button', { name: 'End session' }));
    await shown('anonymous');
    expect(generation()).toHaveTextContent('2');
  });
});

describe('restoring the session', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const restored = () => screen.getByTestId('restored');
  const epoch = () => screen.getByTestId('epoch');
  const generation = () => screen.getByTestId('generation');

  // The session store learns of the user in an effect after the status shows.
  async function suspended() {
    const rendered = await renderSignedIn();
    await waitFor(() => expect(isSuspended()).toBe(false));
    act(() => reportUnauthorized('tab-return'));
    expect(isSuspended()).toBe(true);
    return rendered;
  }

  it('restores the same account once: the epoch grows by one, the session resumes, the generation stays', async () => {
    const { user } = await suspended();

    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    expect(restored()).toHaveTextContent('true');
    expect(epoch()).toHaveTextContent('1');
    expect(generation()).toHaveTextContent('0');
    expect(screen.getByTestId('user')).toHaveTextContent('zoe');
    expect(isSuspended()).toBe(false);
  });

  it('a second restore of the same ended session changes nothing', async () => {
    const { user } = await suspended();
    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    expect(restored()).toHaveTextContent('false');
    expect(epoch()).toHaveTextContent('1');
  });

  it('does nothing while the session has not ended', async () => {
    const { user } = await renderSignedIn();
    await waitFor(() => expect(isSuspended()).toBe(false));

    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    expect(restored()).toHaveTextContent('false');
    expect(epoch()).toHaveTextContent('0');
  });

  it('does nothing for another account: it neither adopts it nor resumes', async () => {
    const { user } = await suspended();

    await user.click(
      screen.getByRole('button', { name: 'Restore as another account' }),
    );

    expect(restored()).toHaveTextContent('false');
    expect(epoch()).toHaveTextContent('0');
    expect(generation()).toHaveTextContent('0');
    expect(screen.getByTestId('user')).toHaveTextContent('zoe');
    expect(isSuspended()).toBe(true);
  });

  it('does nothing when nobody is signed in', async () => {
    server.use(
      http.get(LOGIN_URL, () => new HttpResponse(null, { status: 401 })),
    );
    const { user } = renderWithProviders(<SessionProbe />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );

    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    expect(restored()).toHaveTextContent('false');
    expect(screen.getByTestId('user')).toHaveTextContent('nobody');
  });
});

describe('session mark', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  async function renderMarked() {
    server.use(
      http.get(LOGIN_URL, () =>
        HttpResponse.json({
          username: 'zoe',
          pulp_href: '/pulp/api/v3/users/1/',
        }),
      ),
    );
    const rendered = renderWithProviders(
      <>
        <SessionProbe />
        <MarkProbe />
      </>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );
    await waitFor(() => expect(isSuspended()).toBe(false));
    return rendered;
  }

  const take = (user: Awaited<ReturnType<typeof renderMarked>>['user']) =>
    user.click(screen.getByRole('button', { name: 'Take a mark' }));
  const ask = async (
    user: Awaited<ReturnType<typeof renderMarked>>['user'],
  ) => {
    await user.click(
      screen.getByRole('button', { name: 'Ask about the mark' }),
    );
    // Both ways of asking agree: a copy held since the first render reads the
    // session really in memory.
    expect(screen.getByTestId('mark-current-by-copy')).toHaveTextContent(
      screen.getByTestId('mark-current').textContent ?? '',
    );
    return screen.getByTestId('mark-current').textContent;
  };

  it('is current while the same account stays signed in', async () => {
    const { user } = await renderMarked();

    await take(user);

    expect(await ask(user)).toBe('true');
  });

  it('is not current after a sign-out', async () => {
    const { user } = await renderMarked();
    server.use(
      http.delete(LOGIN_URL, () => new HttpResponse(null, { status: 204 })),
    );
    await take(user);

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );

    expect(await ask(user)).toBe('false');
  });

  it('stays not current after the same account signs in again, because the generation grew', async () => {
    const { user } = await renderMarked();
    server.use(
      http.delete(LOGIN_URL, () => new HttpResponse(null, { status: 204 })),
    );
    await take(user);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('anonymous'),
    );

    await user.click(
      screen.getByRole('button', { name: 'Sign in as the same account' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('authenticated'),
    );

    expect(await ask(user)).toBe('false');
  });

  it('is not current after the session was restored, because the epoch grew', async () => {
    const { user } = await renderMarked();
    act(() => reportUnauthorized('tab-return'));
    await take(user);

    await user.click(
      screen.getByRole('button', { name: 'Restore the session' }),
    );

    expect(screen.getByTestId('epoch')).toHaveTextContent('1');
    expect(await ask(user)).toBe('false');
  });

  it('stays current while the session merely ended', async () => {
    const { user } = await renderMarked();
    await take(user);

    act(() => reportUnauthorized('request'));

    expect(await ask(user)).toBe('true');
  });

  it('records whether the session had ended when the mark was taken', async () => {
    const { user } = await renderMarked();

    await take(user);
    expect(screen.getByTestId('mark-ended')).toHaveTextContent('false');

    act(() => reportUnauthorized('request'));
    await take(user);
    expect(screen.getByTestId('mark-ended')).toHaveTextContent('true');
  });

  it('carries the generation in memory when it is taken', async () => {
    const { user } = await renderMarked();
    server.use(
      http.delete(LOGIN_URL, () => new HttpResponse(null, { status: 204 })),
    );
    await take(user);
    expect(screen.getByTestId('mark-generation')).toHaveTextContent('0');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByTestId('generation')).toHaveTextContent('1'),
    );
    await take(user);

    expect(screen.getByTestId('mark-generation')).toHaveTextContent('1');
  });
});
