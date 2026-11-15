import {
  type BrowserContext,
  type Page,
  type Request,
  expect,
  test,
} from '@playwright/test';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account, origin } from '../support/env';
import { title } from '../support/sign-in';

// An installation that signs in through an external login service sends the
// browser to the address named by UI_EXTERNAL_LOGIN_URI, with the page it asked
// for in `next`, and expects the browser to come back with a session the Pulp
// API accepts. These tests play that service with a page route on the UI's own
// origin: it counts the visits and, where the test wants a session, signs the
// account of the run in through the login API (the way a reverse proxy in front
// of Pulp would) before it redirects back. The real Pulp of the run decides
// every answer; no credential is placed in browser storage.

const STAND_IN_LOGIN = '/stand-in-login/';

interface StandIn {
  // Number of times the browser was sent to the stand-in login service.
  visits: () => number;
}

// Serves the build's own configuration with the external login address added
// and plays the login service. With `establishSession` the visit signs the
// account in first; without it the visitor returns with no session.
async function useStandInLogin(
  page: Page,
  { establishSession }: { establishSession: boolean },
): Promise<StandIn> {
  let visits = 0;

  await page.route('**/pulp-ui-config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      response,
      json: { ...config, UI_EXTERNAL_LOGIN_URI: STAND_IN_LOGIN },
    });
  });

  await page.route(`**${STAND_IN_LOGIN}**`, async (route) => {
    visits += 1;
    if (establishSession) {
      await apiLogin(page.context());
    }
    const next = new URL(route.request().url()).searchParams.get('next');
    await route.fulfill({
      status: 302,
      headers: { location: next ?? '/' },
    });
  });

  return { visits: () => visits };
}

// Signs the account of the run in with the login API inside the context. The
// context's request client shares the cookie jar of its pages, so every page of
// the context is signed in afterwards.
async function apiLogin(context: BrowserContext): Promise<void> {
  const { username, password } = account();
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

// Collects every request the page sends to the Pulp API from now on.
function recordApiRequests(page: Page): () => string[] {
  const seen: string[] = [];
  page.on('request', (request: Request) => {
    if (new URL(request.url()).pathname.startsWith('/pulp/api/')) {
      seen.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return () => [...seen];
}

// Status, About and the login pages open without a session and never start a
// sign-in, so the tests that need one use the task list. The logout test uses
// Status: it is where a person lands after signing in, and logging out there
// must still end on the Signed out page.
test.describe('external login', () => {
  test('an existing session opens the screen without visiting the login address', async ({
    page,
  }) => {
    const standIn = await useStandInLogin(page, { establishSession: false });
    await apiLogin(page.context());

    await page.goto('tasks');

    await expect(title(page, 'Task management')).toBeVisible();
    await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();
    expect(standIn.visits()).toBe(0);
  });

  test('an anonymous visit goes to the login address once and returns signed in', async ({
    page,
  }) => {
    const standIn = await useStandInLogin(page, { establishSession: true });

    await page.goto('tasks');

    await expect(title(page, 'Task management')).toBeVisible();
    await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/\/ui\/tasks\/?$/);
    expect(standIn.visits()).toBe(1);
  });

  test('a return without a session stops after one visit with "Sign-in did not complete"', async ({
    page,
  }) => {
    const standIn = await useStandInLogin(page, { establishSession: false });

    await page.goto('tasks');

    await expect(page.getByText('Sign-in did not complete')).toBeVisible();
    // A loop would send the browser away again within moments; give it the
    // time to do so, then count.
    await page.waitForTimeout(2000);
    await expect(page.getByText('Sign-in did not complete')).toBeVisible();
    expect(standIn.visits()).toBe(1);
  });

  test('logout lands on the Signed out page and sends no API request afterwards', async ({
    page,
  }) => {
    const standIn = await useStandInLogin(page, { establishSession: false });
    await apiLogin(page.context());
    await page.goto('status');
    await expect(page.locator('[data-cy=user-dropdown]')).toBeVisible();

    await page.locator('[data-cy=user-dropdown]').click();
    await page.getByText('Logout', { exact: true }).click();

    await expect(title(page, 'Signed out')).toBeVisible();
    expect(new URL(page.url()).pathname).toMatch(/\/ui\/signed-out\/?$/);

    const requests = recordApiRequests(page);
    await page.waitForTimeout(2000);
    expect(requests()).toEqual([]);
    expect(standIn.visits()).toBe(0);
  });
});
