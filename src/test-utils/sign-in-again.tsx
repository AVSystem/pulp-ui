import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect } from 'vitest';
import { isSignedIn, reportUnauthorized } from '../session/session-events';
import { useUserContext } from '../user-context';
import { server } from './server';

// Helpers for screens that read their data again after the same user signs in
// again. The screen under test is rendered next to SignInAgain; clicking its
// button runs the sign-in the dialog runs, which grows the session epoch.

const USER = { username: 'zoe', pulp_href: '/pulp/api/v3/users/1/' };

// Answers the session check and the sign-in call with one known user. The
// user is staff, so the permission provider lets every screen show its
// actions and the tests are about the session, not about permissions. For the
// same reason a screen rendered through it cannot reveal a control that is
// shown to someone who may not use it: a test about what a user may see signs
// in through servePermissions instead.
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

// The sign-in the dialog runs. The dialog is open only while the session has
// ended, and the session is restored only while it has ended, so the ended
// state is set first (a no-op for a session that already ended).
export const signInThroughDialog = (
  signInAgain: (username: string, password: string) => Promise<unknown>,
) => {
  reportUnauthorized('request');
  return signInAgain('zoe', 'secret');
};

export function SignInAgain() {
  const { signInAgain, status } = useUserContext();

  return (
    <>
      <p data-testid='session'>{status}</p>
      <button type='button' onClick={() => signInThroughDialog(signInAgain)}>
        Sign in again
      </button>
    </>
  );
}

// Waits until the session check has answered, so a sign-in counts as the same
// user coming back. The session store learns of the user in an effect that runs
// after the status is shown; a refusal reported before that would be ignored.
export const signedIn = () =>
  waitFor(() => {
    expect(screen.getByTestId('session')).toHaveTextContent('authenticated');
    expect(isSignedIn()).toBe(true);
  });

// Records every request that is not a read, as "METHOD /path".
export function recordWrites() {
  const writes: string[] = [];
  const onStart = ({ request }: { request: Request }) => {
    if (!['GET', 'HEAD'].includes(request.method)) {
      writes.push(`${request.method} ${new URL(request.url).pathname}`);
    }
  };
  server.events.on('request:start', onStart);
  // Removes only this helper's listener, so another helper active in the same
  // test keeps recording.
  return {
    writes,
    stop: () => server.events.removeListener('request:start', onStart),
  };
}
