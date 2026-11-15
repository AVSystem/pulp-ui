import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect } from 'vitest';
import { useUserContext } from '../user-context';
import { server } from './server';

// Helpers for screens that read their data again after the same user signs in
// again. The screen under test is rendered next to SignInAgain; clicking its
// button runs the sign-in the dialog runs, which grows the session epoch.

const USER = { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' };

// Answers the session check and the sign-in call with one known user. The
// user is staff, so the permission provider lets every screen show its
// actions and the tests are about the session, not about permissions.
export function serveSignIn() {
  server.use(
    http.get('*/pulp/api/v3/users/1/', () =>
      HttpResponse.json({ ...USER, id: 1, is_staff: true, groups: [] }),
    ),
    http.get('*/pulp/api/v3/login/', () => HttpResponse.json(USER)),
    http.post('*/pulp/api/v3/login/', () =>
      HttpResponse.json(USER, { status: 201 }),
    ),
  );
}

export function SignInAgain() {
  const { signInAgain, status } = useUserContext();

  return (
    <>
      <p data-testid='session'>{status}</p>
      <button type='button' onClick={() => signInAgain('zoe', 'secret')}>
        Sign in again
      </button>
    </>
  );
}

// Waits until the session check has answered, so a sign-in counts as the same
// user coming back.
export const signedIn = () =>
  waitFor(() =>
    expect(screen.getByTestId('session')).toHaveTextContent('authenticated'),
  );

// Records every request that is not a read, as "METHOD /path".
export function recordWrites() {
  const writes: string[] = [];
  server.events.on('request:start', ({ request }) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
    }
  });
  return {
    writes,
    stop: () => server.events.removeAllListeners(),
  };
}
