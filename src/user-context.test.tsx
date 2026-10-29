import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { useUserContext } from './user-context';

const LOGIN_URL = '*/pulp/api/v3/login/';

// Shows the session state and offers a logout button that reports how the
// logout promise ended.
function SessionProbe() {
  const { status, user, logout } = useUserContext();
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
});
