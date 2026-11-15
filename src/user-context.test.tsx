import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPageUrl } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { blockStorage } from 'src/test-utils/storage';
import { useUserContext } from './user-context';

const LOGIN_URL = '*/pulp/api/v3/login/';

// Shows the session state and offers a logout button that reports how the
// logout promise ended.
function SessionProbe() {
  const { status, user, logout, retrySessionCheck } = useUserContext();
  const [outcome, setOutcome] = useState('none');

  return (
    <>
      <p data-testid='status'>{status}</p>
      <p data-testid='user'>{user?.username ?? 'nobody'}</p>
      <p data-testid='outcome'>{outcome}</p>
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
