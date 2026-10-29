import { expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { origin } from '../support/env';
import { submitLoginForm, title } from '../support/sign-in';
import {
  apiLogin,
  isLoginCall,
  logOutThroughMenu,
  signedOut,
  watchApiCalls,
} from './session-helpers';

const loginForm = '#pf-login-username-id';
const userMenu = '[data-cy=user-dropdown]';
const loginMenuItem = '[data-cy=pulp-menu-item-Login]';

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

    const visible = await page.evaluate(() => document.cookie);
    expect(visible).toContain('csrftoken');
    expect(visible).not.toContain('sessionid');

    const stored = await page.evaluate(() => ({
      everything: JSON.stringify([
        Object.entries(localStorage),
        Object.entries(sessionStorage),
      ]),
      localCredentials: localStorage.getItem('credentials'),
      sessionCredentials: sessionStorage.getItem('credentials'),
    }));
    expect(stored.everything).not.toContain(password);
    expect(stored.localCredentials).toBeNull();
    expect(stored.sessionCredentials).toBeNull();

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
    const name = 'Żółw-ćwik';
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

  test('logging out ends the server session', async ({ page, context }) => {
    await apiLogin(context);
    await page.goto('status');
    await expect(page.locator(userMenu)).toBeVisible();

    const answer = await logOutThroughMenu(page);
    expect(answer.status()).toBe(204);

    await expect(page.locator(loginMenuItem)).toBeVisible();
    await expect(page.locator(userMenu)).toHaveCount(0);

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
    const ended = await page.evaluate(async () => {
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
    expect(ended).toBe(204);

    await page.locator(userMenu).click();
    const answer = page.waitForResponse((r) => isLoginCall(r, 'DELETE'));
    await page.getByText('Logout', { exact: true }).click();
    await answer;

    await expect(page.locator(loginMenuItem)).toBeVisible();
    await expect(page.locator(userMenu)).toHaveCount(0);
    await expect(page.locator('.pf-v5-c-alert')).toHaveCount(0);
  });
});
