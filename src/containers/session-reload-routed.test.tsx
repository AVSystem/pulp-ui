import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useRoutes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { UserAPI } from 'src/api/user';
import { AppContextProvider } from 'src/app-context';
import { dataRoutes } from 'src/app-routes';
import { ReauthDialog } from 'src/session/reauth-dialog';
import { resetSessionEvents } from 'src/session/session-events';
import { servePermissions } from 'src/test-utils/permissions';
import { listOf, user } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { useUserContext } from 'src/user-context';

// The administration screens as the application mounts them: through the route
// guard, with the real permission provider. A screen stays mounted when the
// same user signs in again, so what was typed in it is still there.

const API = '/pulp/api/v3';

const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

function Routed() {
  const routes = useRoutes(guardedRoutes);
  const { status, generation } = useUserContext();
  return (
    <>
      <p data-testid='session'>{status}</p>
      <p data-testid='generation'>{generation}</p>
      <ReadUser />
      {routes}
    </>
  );
}

// Sends the kind of request every screen sends, so the session can end the
// way it does in the application.
function ReadUser() {
  return (
    <button
      type='button'
      onClick={() => UserAPI.get('4').catch(() => undefined)}
    >
      Probe request
    </button>
  );
}

afterEach(() => {
  Reflect.deleteProperty(document, 'visibilityState');
  resetSessionEvents();
  server.events.removeAllListeners();
});

describe('an administration screen when the same user signs in again', () => {
  const USER = user({ id: 4, username: 'zz-ann', first_name: 'Ann' });

  it('stays mounted and keeps the typed text', async () => {
    // a user who holds the permissions but is not staff, as the guard of the
    // screen reads them
    servePermissions({
      own: [['auth.view_user', 'auth.change_user']],
    });
    server.use(
      http.get(`*${API}/users/4/`, () => HttpResponse.json(USER)),
      listOf(`${API}/groups/`, []).handler,
    );
    const { user: u } = renderWithProviders(
      <AppContextProvider>
        <Routed />
        <ReauthDialog />
      </AppContextProvider>,
      { route: '/users/edit/4' },
    );

    const field = await screen.findByLabelText(/First name/);
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('authenticated'),
    );
    await u.clear(field);
    await u.type(field, 'Typed');

    // a request is refused: the session has ended
    server.use(
      http.get(`*${API}/users/4/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Probe request' }));
    const dialog = await screen.findByRole('dialog', { name: /Sign in again/ });

    // the permissions are read again for the same user; hold the read
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`*${API}/users/7/`, async () => {
        await held;
        return HttpResponse.json({
          username: 'zoe',
          pulp_href: `${API}/users/7/`,
          id: 7,
          is_staff: false,
          groups: [],
        });
      }),
      http.get(`*${API}/users/4/`, () => HttpResponse.json(USER)),
    );
    await u.type(within(dialog).getByLabelText(/^password/i), 'secret');
    await u.click(within(dialog).getByRole('button', { name: 'Log in' }));

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sign in again/ }),
      ).not.toBeInTheDocument(),
    );
    // while the permission read is pending the screen is not replaced
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toBe(field);
    expect(field).toHaveValue('Typed');

    release();
    await waitFor(() =>
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/First name/)).toBe(field);
    expect(field).toHaveValue('Typed');
  });

  it('stays mounted and keeps the typed text when the session is restored by a return to the window', async () => {
    const { requests } = servePermissions({
      own: [['auth.view_user', 'auth.change_user']],
    });
    let userReads = 0;
    const permissionReads = () =>
      requests.filter((request) => request === `${API}/users/7/`).length;
    server.use(
      http.get(`*${API}/users/4/`, () => {
        userReads += 1;
        return HttpResponse.json(USER);
      }),
      listOf(`${API}/groups/`, []).handler,
    );
    const { user: u } = renderWithProviders(
      <AppContextProvider>
        <Routed />
        <ReauthDialog />
      </AppContextProvider>,
      { route: '/users/edit/4' },
    );

    const field = await screen.findByLabelText(/First name/);
    await waitFor(() =>
      expect(screen.getByTestId('session')).toHaveTextContent('authenticated'),
    );
    await u.clear(field);
    await u.type(field, 'Typed');

    // a request is refused: the session has ended
    server.use(
      http.get(`*${API}/users/4/`, () =>
        HttpResponse.json({ detail: 'no' }, { status: 401 }),
      ),
    );
    await u.click(screen.getByRole('button', { name: 'Probe request' }));
    await screen.findByRole('dialog', { name: /Sign in again/ });
    const userReadsBefore = userReads;
    const permissionReadsBefore = permissionReads();

    // the session comes back in another window; this one gains focus
    server.use(
      http.get(`*${API}/users/4/`, () => {
        userReads += 1;
        return HttpResponse.json(USER);
      }),
    );
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Sign in again/ }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(userReads).toBe(userReadsBefore + 1));
    await waitFor(() =>
      expect(permissionReads()).toBe(permissionReadsBefore + 1),
    );
    expect(screen.getByLabelText(/First name/)).toBe(field);
    expect(field).toHaveValue('Typed');
    expect(screen.getByTestId('generation')).toHaveTextContent('0');
  });
});
