import { type BrowserContext, type Response, expect } from '@playwright/test';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { origin } from './env';

// Helpers that the remote, shell and smoke specs share for starting a session
// without the login form and for waiting on the answer that tells the page
// what the account may do.

// A browser context that holds no session at all, for tests that sign in or
// out. They never touch the storage state shared by the other tests, so
// ending a session here cannot break a later test.
export const signedOut = { cookies: [], origins: [] };

// Signs the given account in inside the context with the login API. The
// context's request client shares the cookie jar of its pages, so every page
// opened afterwards in that context is signed in. The credentials come from
// the caller, which reads them from the environment.
export async function apiLoginAs(
  context: BrowserContext,
  { username, password }: { username: string; password: string },
): Promise<void> {
  const response = await context.request.post(
    `${origin()}/pulp/api/v3/login/`,
    {
      headers: {
        Authorization: basicAuthorization(username, password),
        'X-Requested-With': 'XMLHttpRequest',
      },
    },
  );
  expect(response.status(), 'API sign in').toBe(201);
}

// True for the answer to the read of the signed-in user's roles, which is how
// the application learns what the account may do.
export function isPermissionsRead(response: Response): boolean {
  return (
    response.request().method() === 'GET' &&
    /\/pulp\/api\/v3\/users\/[^/]+\/roles\/$/.test(
      new URL(response.url()).pathname,
    )
  );
}
