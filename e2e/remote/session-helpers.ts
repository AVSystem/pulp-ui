import {
  type BrowserContext,
  type Page,
  type Response,
  expect,
} from '@playwright/test';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { type Role, account } from '../support/accounts';
import { origin } from '../support/env';
import { submitLoginForm } from '../support/sign-in';

export const userMenu = '[data-cy=user-dropdown]';
export const loginMenuItem = '[data-cy=pulp-menu-item-login]';

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

// Ends the session a test left open in its context, the way a person does:
// through the menu of a fresh page, checking the server dropped it. A context
// without a session cookie needs nothing.
export async function logOutWhatRemains(
  page: Page,
  context: BrowserContext,
): Promise<void> {
  const open = async () =>
    (await context.cookies()).some(({ name }) => name === 'sessionid');
  if (!(await open())) {
    return;
  }
  await page.goto('status');
  await expect(page.locator(userMenu)).toBeVisible();
  await logOutThroughMenu(page);
  await expect(page.locator(loginMenuItem)).toBeVisible();
  expect(await open(), 'the session cookie after the sign out').toBe(false);
}

// Signs the role's account in on a signed-out page of the application: the
// masthead Login opens the sign-in page with the current address as the place
// to return to, and the form is filled in like a person does. Ends when the
// page shows the account menu again.
export async function signInThroughLoginPage(
  page: Page,
  role: Role,
): Promise<void> {
  const { username, password } = account(role);
  await page.locator(loginMenuItem).click();
  await expect(page.locator('#pf-login-username-id')).toBeVisible();
  await submitLoginForm(page, username, password);
  await expect(page.locator(userMenu)).toBeVisible();
}

// Ends the server session behind the page's back; shared with the smoke specs.
export { endSessionBehindThePage } from '../support/session-cover';

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
