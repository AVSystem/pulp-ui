import {
  type Page,
  type Request,
  type Response,
  expect,
  test,
} from '@playwright/test';
import { account } from '../support/accounts';
import { TestObjects } from '../support/api';
import { origin } from '../support/env';
import { submitLoginForm, title } from '../support/sign-in';
import {
  apiLogin,
  endSessionBehindThePage,
  isLoginCall,
  logOutThroughMenu,
  signedOut,
  watchApiCalls,
} from './session-helpers';

const loginForm = '#pf-login-username-id';
const userMenu = '[data-cy=user-dropdown]';
const loginMenuItem = '[data-cy=pulp-menu-item-login]';

// The answer to the first GET of the status endpoint that the page sends after
// the answer to the sign out came back. Register it before pressing Logout. A
// status read that started earlier and is answered later does not count: it
// was made with the session and says nothing about what the page reads without
// one.
function statusAnswerAfterSignOut(page: Page): Promise<Response> {
  let signedOutNow = false;
  const after = new Set<Request>();
  page.on('response', (response) => {
    if (isLoginCall(response, 'DELETE')) {
      signedOutNow = true;
    }
  });
  page.on('request', (request) => {
    if (
      signedOutNow &&
      request.method() === 'GET' &&
      new URL(request.url()).pathname === '/pulp/api/v3/status/'
    ) {
      after.add(request);
    }
  });
  return page.waitForResponse((response) => after.has(response.request()));
}

// After signing out on the Status screen nothing the administrator saw may
// stay: no workers, no Versions card, the note for visitors is shown, and the
// answer the page read after the sign out carries no versions.
async function expectVisitorStatus(page: Page, answer: Promise<Response>) {
  await expect(page.getByText('Online workers', { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText('Versions', { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      'Versions, workers and storage are shown to signed-in users.',
    ),
  ).toBeVisible();
  const body = (await (await answer).json()) as Record<string, unknown>;
  expect('versions' in body, 'the status answer after the sign out').toBe(
    false,
  );
}

// The first test runs on the shared session of the admin account that the setup
// project saved. Every test after it starts from a context of its own: tests
// that sign in or out must never use, or end, the shared session.

test('a deep link to a list page survives a reload', async ({ page }) => {
  await page.goto('file/repositories');
  await expect(title(page, 'Repositories')).toBeVisible();

  await page.reload();

  await expect(page).toHaveURL(/\/ui\/file\/repositories\/?$/);
  await expect(title(page, 'Repositories')).toBeVisible();
});

test.describe('sessions of their own', () => {
  test.use({ storageState: signedOut });

  // A test that signed in leaves a live session on the server unless it is
  // ended: end whatever session the context still holds, through the menu the
  // way a person does, and check the server dropped it.
  test.afterEach(async ({ page, context }) => {
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
  });

  test('signing in through the form keeps the session out of reach of scripts and stores no credential', async ({
    page,
    context,
  }) => {
    const { username, password } = account('admin');
    const watched = watchApiCalls(page);

    await page.goto('login');
    await submitLoginForm(page, username, password);
    await expect(title(page, 'Status')).toBeVisible();
    await expect(page.locator(userMenu)).toBeVisible();
    // more API traffic after the sign in, from another page
    await page.goto('file/repositories');
    await expect(title(page, 'Repositories')).toBeVisible();

    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === 'sessionid');
    expect(session, 'a session cookie was set').toBeDefined();
    expect(session?.httpOnly, 'session cookie is HttpOnly').toBe(true);
    expect(session?.secure, 'session cookie is Secure').toBe(true);

    // Booleans, never the values: a failed comparison prints both sides, and
    // these hold the session cookie names and the password.
    const visible = await page.evaluate(() => document.cookie);
    expect(
      visible.includes('csrftoken'),
      'the CSRF cookie is visible to scripts',
    ).toBe(true);
    expect(
      visible.includes('sessionid'),
      'the session cookie is hidden from scripts',
    ).toBe(false);

    const stored = await page.evaluate(() => ({
      everything: JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
      localCredentials: localStorage.getItem('credentials'),
      sessionCredentials: sessionStorage.getItem('credentials'),
    }));
    expect(
      stored.everything.includes(password),
      'stored text must not contain the password',
    ).toBe(false);
    expect(
      stored.localCredentials === null,
      'localStorage holds no credentials entry',
    ).toBe(true);
    expect(
      stored.sessionCredentials === null,
      'sessionStorage holds no credentials entry',
    ).toBe(true);

    // Exactly one call carries the Basic header: the sign in itself.
    const calls = watched.calls;
    expect(
      calls
        .filter((c) => c.hasAuthorization)
        .map((c) => `${c.method} ${c.url}`),
    ).toEqual([`POST ${origin()}/pulp/api/v3/login/`]);
  });

  test('credentials left in storage by an older version are removed unread and the login page shows', async ({
    page,
  }) => {
    const watched = watchApiCalls(page);

    await page.goto('login');
    await page.evaluate(() => {
      const legacy = JSON.stringify({ username: 'x', password: 'y' });
      localStorage.setItem('credentials', legacy);
      sessionStorage.setItem('credentials', legacy);
    });

    await page.reload();

    await expect(page.locator(loginForm)).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => [
          localStorage.getItem('credentials'),
          sessionStorage.getItem('credentials'),
        ]),
      )
      .toEqual([null, null]);
    const authorized = watched.calls.filter((c) => c.hasAuthorization);
    expect(authorized, 'no request used the stored values').toEqual([]);
  });

  test('a refused sign in with Polish letters in the user name shows the server message and raises no script error', async ({
    page,
    request,
  }) => {
    // Letters outside Latin-1: a header built any other way than from UTF-8
    // bytes throws in the browser before the request is even sent.
    const name = '\u017b\u00f3\u0142w-\u0107wik';
    const wrongPassword = 'not-the-password';
    const scriptErrors: Error[] = [];
    page.on('pageerror', (error) => scriptErrors.push(error));

    // What the server says to the same attempt, read through the API.
    const direct = await request.get(`${origin()}/pulp/api/v3/login/`, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Authorization: `Basic ${Buffer.from(`${name}:${wrongPassword}`, 'utf8').toString('base64')}`,
      },
    });
    expect(direct.status()).toBe(401);
    const detail = ((await direct.json()) as { detail?: string }).detail;
    expect(detail, 'the server explains the refusal').toBeTruthy();

    await page.goto('login');
    await submitLoginForm(page, name, wrongPassword);

    await expect(page.getByText(detail as string)).toBeVisible();
    await expect(page.locator(loginForm)).toBeVisible();
    expect(scriptErrors).toEqual([]);
  });

  test('a next address pointing at another site is not followed after signing in', async ({
    page,
  }) => {
    const { username, password } = account('admin');
    const wentElsewhere: string[] = [];
    // Nothing may leave the deployment's origin; a navigation there is recorded
    // and refused.
    await page.route(/^https?:\/\/evil\.example\//, (route) => {
      wentElsewhere.push(route.request().url());
      return route.abort();
    });

    await page.goto('login/?next=//evil.example');
    await submitLoginForm(page, username, password);
    await expect(page.locator(userMenu)).toBeVisible();

    expect(new URL(page.url()).origin).toBe(origin());
    expect(wentElsewhere).toEqual([]);
  });

  test('signing out on a list page with a query and signing in again lands on the same address', async ({
    page,
    context,
  }) => {
    const { username, password } = account('admin');
    await apiLogin(context);

    const query = '?page_size=20&sort=-name&page=1';
    await page.goto(`deb/repositories${query}`);
    await expect(title(page, 'Repositories')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`deb/repositories\\${query}$`));

    await logOutThroughMenu(page);
    await expect(page.locator(loginMenuItem)).toBeVisible();

    // the application asks for the sign in again once the page needs the
    // server; a reload of the same address does that
    await page.goto(`deb/repositories${query}`);
    await expect(page.locator(loginForm)).toBeVisible();
    await submitLoginForm(page, username, password);

    await expect(title(page, 'Repositories')).toBeVisible();
    const landed = new URL(page.url());
    expect(landed.pathname).toMatch(/\/ui\/deb\/repositories\/?$/);
    expect(
      Object.fromEntries(landed.searchParams),
      'the query after signing in again',
    ).toEqual({ page_size: '20', sort: '-name', page: '1' });
  });

  test('logging out ends the server session', async ({ page, context }) => {
    await apiLogin(context);
    await page.goto('status');
    await expect(page.locator(userMenu)).toBeVisible();
    await expect(
      page.getByText('Online workers', { exact: true }),
    ).toBeVisible();

    const statusAnswer = statusAnswerAfterSignOut(page);
    const answer = await logOutThroughMenu(page);
    expect(answer.status()).toBe(204);

    await expect(page.locator(loginMenuItem)).toBeVisible();
    await expect(page.locator(userMenu)).toHaveCount(0);
    await expectVisitorStatus(page, statusAnswer);

    const afterwards = await page.evaluate(
      async () =>
        (
          await fetch('/pulp/api/v3/login/', {
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
          })
        ).status,
    );
    expect(afterwards).toBe(401);
  });

  test('logging out after the session already ended shows no error', async ({
    page,
    context,
  }) => {
    await apiLogin(context);
    await page.goto('status');
    await expect(page.locator(userMenu)).toBeVisible();

    // End the session behind the page's back, the way another tab would.
    const ended = await endSessionBehindThePage(page);
    expect(ended).toBe(204);

    await page.locator(userMenu).click();
    const statusAnswer = statusAnswerAfterSignOut(page);
    const answer = page.waitForResponse((r) => isLoginCall(r, 'DELETE'));
    await page.getByText('Logout', { exact: true }).click();
    await answer;

    await expect(page.locator(loginMenuItem)).toBeVisible();
    await expect(page.locator(userMenu)).toHaveCount(0);
    await expect(page.locator('.pf-v6-c-alert')).toHaveCount(0);
    await expectVisitorStatus(page, statusAnswer);
  });

  test.describe('behind an open edit form', () => {
    let objects: TestObjects;

    test.beforeAll(async () => {
      objects = await TestObjects.open('ended-session');
    });

    test.afterAll(async () => {
      test.setTimeout(180_000);
      await objects.cleanUp();
    });

    test('an ended session opens the sign-in dialog and signing in again keeps the typed content without repeating the action', async ({
      page,
      context,
    }) => {
      const { username, password } = account('admin');
      await apiLogin(context);
      const repository = await objects.create('repositories/file/file/', {
        name: objects.name('edit'),
      });
      const typed = 'typed before the session ended';

      // Every request of the page to the API, in order, with the answer's
      // status once it is known.
      const sent: { method: string; path: string }[] = [];
      page.on('request', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.startsWith('/pulp/api/')) {
          sent.push({ method: request.method(), path: pathname });
        }
      });
      const isRepositoryRead = (call: { method: string; path: string }) =>
        call.method === 'GET' &&
        call.path === '/pulp/api/v3/repositories/file/file/';
      const isRepositoryWrite = (call: { method: string; path: string }) =>
        call.method === 'PATCH' && call.path === repository.pulp_href;

      await page.goto(`file/repositories/edit/${repository.name}`);
      await expect(page.locator('#description')).toBeVisible();
      await page.locator('#description').fill(typed);

      expect(await endSessionBehindThePage(page)).toBe(204);

      const refused = page.waitForResponse(
        (response) =>
          response.request().method() === 'PATCH' &&
          new URL(response.url()).pathname === repository.pulp_href,
      );
      await page.getByRole('button', { name: 'Save' }).click();
      expect((await refused).status(), 'the refused write').toBe(401);

      const dialog = page.getByRole('dialog', { name: 'Sign in again' });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByText(
          'The last action was not completed. Repeat it after you log in.',
        ),
      ).toBeVisible();

      const writesBefore = sent.filter(isRepositoryWrite).length;
      const readsBefore = sent.filter(isRepositoryRead).length;
      expect(writesBefore, 'the one refused write').toBe(1);

      await dialog.getByLabel('Username').fill(username);
      await dialog.getByLabel('Password').fill(password);
      await dialog.getByRole('button', { name: 'Log in' }).click();

      await expect(dialog).toHaveCount(0);
      // the screen reads the repository again; the typed text stays
      await expect
        .poll(() => sent.filter(isRepositoryRead).length, {
          message: 'a read of the repository after signing in',
        })
        .toBeGreaterThan(readsBefore);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('#description')).toHaveValue(typed);
      expect(
        sent.filter(isRepositoryWrite).length,
        'writes of the repository after the refused one',
      ).toBe(writesBefore);
      await expect(page).toHaveURL(/file\/repositories\/edit\//);
    });
  });
});
