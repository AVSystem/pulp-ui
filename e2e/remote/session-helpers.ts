import {
  type BrowserContext,
  type Page,
  type Response,
  expect,
} from '@playwright/test';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { type Role, account } from '../support/accounts';
import { origin } from '../support/env';

// A browser context that holds no session at all, for tests that sign in or
// out. They never touch the storage state shared by the other tests, so
// ending a session here cannot break a later test.
export const signedOut = { cookies: [], origins: [] };

// Signs the role's account in inside the given context with the login API. The
// context's request client shares the cookie jar of its pages, so every page
// opened afterwards in that context is signed in.
export async function apiLogin(
  context: BrowserContext,
  role: Role = 'admin',
): Promise<void> {
  const { username, password } = account(role);
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

// True for a call to the login endpoint made with the given method.
export function isLoginCall(response: Response, method: string): boolean {
  return (
    response.request().method() === method &&
    new URL(response.url()).pathname === '/pulp/api/v3/login/'
  );
}

// Clicks Logout in the user menu and returns the answer to the DELETE the
// application sends.
export async function logOutThroughMenu(page: Page): Promise<Response> {
  await page.locator('[data-cy=user-dropdown]').click();
  const answer = page.waitForResponse((r) => isLoginCall(r, 'DELETE'));
  await page.getByText('Logout', { exact: true }).click();
  return answer;
}

// Ends the server session behind the page's back, the way another tab or an
// expiry would: the page still looks signed in until its next request. Returns
// the status of the DELETE.
export async function endSessionBehindThePage(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const token = /(?:^|; )csrftoken=([^;]*)/.exec(document.cookie)?.[1];
    const response = await fetch('/pulp/api/v3/login/', {
      method: 'DELETE',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-CSRFToken': token ?? '',
      },
    });
    return response.status;
  });
}

export interface ApiCall {
  method: string;
  url: string;
  hasAuthorization: boolean;
}

// Records every call to the API that the page sends, with whether the request
// carries an Authorization header. The headers are read at the moment the
// request is sent: reading them later can wait forever for a request that a
// navigation has already cancelled.
export function watchApiCalls(page: Page): { calls: ApiCall[] } {
  const calls: ApiCall[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/pulp/api/')) {
      calls.push({
        method: request.method(),
        url: request.url(),
        hasAuthorization: 'authorization' in request.headers(),
      });
    }
  });
  return { calls };
}
