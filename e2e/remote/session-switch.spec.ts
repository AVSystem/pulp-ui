import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { TestObjects } from '../support/api';
import {
  coveredAt,
  loginChecks,
  markWindow,
  returnToTab,
  windowMarked,
} from '../support/session-cover';
import { title } from '../support/sign-in';
import {
  apiLogin,
  endSessionBehindThePage,
  logOutThroughMenu,
  logOutWhatRemains,
  loginMenuItem,
  signInThroughLoginPage,
  signedOut,
  userMenu,
} from './session-helpers';

// What the sign-in-again dialog does in a real browser when another account
// signs in through it, when it is stacked over another dialog, and when the
// user returns to a tab whose session another tab ended. Every test runs in a
// context of its own with a fresh session, because ending a session here must
// never touch the session the other remote tests share.

test.use({ storageState: signedOut });

// A test that signed in leaves a live session on the server unless it is
// ended: end whatever session the context still holds, the way a person does.
test.afterEach(async ({ page, context }) => {
  await logOutWhatRemains(page, context);
});

// A request the page sends on its own after the session ended behind it: moving
// to another list page inside the application reads from the server and is
// refused.
async function provokeRefusal(page: Page) {
  const refused = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.startsWith('/pulp/api/') &&
      response.status() === 401,
  );
  await page.locator('[data-cy="pulp-menu-item-tasks"]').click();
  await refused;
}

// Whether the account menu names the given user. A boolean, so a failure never
// prints the name.
async function menuNames(page: Page, username: string): Promise<boolean> {
  const label = await page.locator(userMenu).getAttribute('aria-label');
  return label === `Account menu for ${username}`;
}

test('another account signing in through the dialog loads the start page under that account', async ({
  page,
  context,
}) => {
  const viewer = account('viewer');
  await apiLogin(context);
  await page.goto('file/repositories');
  await expect(title(page, 'Repositories')).toBeVisible();
  expect(await menuNames(page, account('admin').username)).toBe(true);

  expect(await endSessionBehindThePage(page)).toBe(204);
  await provokeRefusal(page);

  const dialog = page.getByRole('dialog', { name: 'Sign in again' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Username').fill(viewer.username);
  await dialog.getByLabel('Password').fill(viewer.password);
  await dialog.getByRole('button', { name: 'Log in' }).click();

  // everything in memory belonged to the previous account: the page loads
  // again at the start page
  await expect(page).toHaveURL(/\/ui\/status\/?$/);
  await expect(title(page, 'Status')).toBeVisible();
  await expect(page.locator(userMenu)).toBeVisible();
  expect(
    await menuNames(page, viewer.username),
    'the viewer is signed in',
  ).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Sign in again' })).toHaveCount(
    0,
  );

  // the session belongs to the viewer: a reload keeps it
  await page.reload();
  await expect(page.locator(userMenu)).toBeVisible();
  expect(
    await menuNames(page, viewer.username),
    'the viewer is still signed in after a reload',
  ).toBe(true);
});

test.describe('over an open dialog', () => {
  let objects: TestObjects;

  test.beforeAll(async () => {
    objects = await TestObjects.open('session-switch');
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    await objects.cleanUp();
  });

  test('the sign-in dialog keeps an open sync dialog and its options, and the same user signing in again sends no second sync request', async ({
    page,
    context,
  }) => {
    const admin = account('admin');
    // the address is reserved for examples and is never contacted: the only
    // sync request of this test is refused before it is queued
    const remote = await objects.create('remotes/file/file/', {
      name: objects.name('remote'),
      url: 'https://pulp.example/zz-e2e/PULP_MANIFEST',
    });
    const repository = await objects.create('repositories/file/file/', {
      name: objects.name('repo'),
      remote: remote.pulp_href,
    });
    const name = repository.name as string;
    await apiLogin(context);

    const syncPosts: string[] = [];
    page.on('request', (request) => {
      const { pathname } = new URL(request.url());
      if (
        request.method() === 'POST' &&
        pathname === `${repository.pulp_href}sync/`
      ) {
        syncPosts.push(pathname);
      }
    });

    await page.goto(`file/repositories/detail/${name}`);
    await expect(title(page, name)).toBeVisible();
    await page.getByRole('button', { name: 'Sync', exact: true }).click();

    const syncDialog = page.getByRole('dialog', {
      name: `Sync repository "${name}"`,
    });
    await expect(syncDialog).toBeVisible();
    const mirror = syncDialog.getByRole('switch', {
      name: /^Content not present in remote/,
    });
    await expect(mirror).toBeChecked();
    // the visible toggle of the switch is a label that sits over its input
    await syncDialog
      .getByText(/^Content not present in remote repository/)
      .click();
    await expect(mirror).not.toBeChecked();

    expect(await endSessionBehindThePage(page)).toBe(204);
    const refused = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${repository.pulp_href}sync/`,
    );
    await syncDialog.getByRole('button', { name: 'Sync', exact: true }).click();
    expect((await refused).status(), 'the refused sync request').toBe(401);

    const signIn = page.getByRole('dialog', { name: 'Sign in again' });
    await expect(signIn).toBeVisible();
    expect(syncPosts, 'sync requests before signing in again').toHaveLength(1);

    await signIn.getByLabel('Password').fill(admin.password);
    await signIn.getByRole('button', { name: 'Log in' }).click();
    await expect(signIn).toHaveCount(0);
    await page.waitForLoadState('networkidle');

    // the sync dialog is still open with the option as the user left it, and
    // the refused request was not sent again
    await expect(syncDialog).toBeVisible();
    await expect(mirror).not.toBeChecked();
    expect(syncPosts, 'sync requests after signing in again').toHaveLength(1);

    await syncDialog
      .getByRole('contentinfo')
      .getByRole('button', { name: 'Close' })
      .click();
    await expect(syncDialog).toHaveCount(0);
  });
});

// Returning to a tab whose session another tab ended. One context holds both
// pages, so they share one session. The return is dispatched inside the page
// (see returnToTab), because a headless browser never tells a page that the
// user came back to it.
test.describe('returning to a tab whose session another tab ended', () => {
  const statusAddress = 'status';

  const workers = (page: Page) =>
    page.getByText('Online workers', { exact: true });
  const signInDialog = (page: Page) =>
    page.getByRole('dialog', { name: 'Sign in again' });

  // Two pages of one context signed in as the administrator on the Status
  // screen, which holds data that only an administrator sees. Page A has a
  // marker on its window and a record of the checks it sends; the session then
  // ends in page B, and page A learns of it on its return.
  async function openWithSessionEndedInB(context: BrowserContext) {
    await apiLogin(context);
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    await pageA.goto(statusAddress);
    await pageB.goto(statusAddress);
    for (const page of [pageA, pageB]) {
      await expect(workers(page)).toBeVisible();
    }
    await markWindow(pageA);
    const checks = loginChecks(pageA);

    await logOutThroughMenu(pageB);
    await expect(pageB.locator(loginMenuItem)).toBeVisible();

    await returnToTab(pageA, 'visibility');
    await expect
      .poll(() => checks.statuses, { message: 'the check of page A' })
      .toEqual([401]);
    await expect(signInDialog(pageA)).toBeVisible();
    expect(
      await coveredAt(pageA, workers(pageA)),
      'the staff data of page A is covered by the opaque layer',
    ).toBe(true);
    return { pageA, pageB, checks };
  }

  test('the same account signing in on the other tab restores the session on the next return, with no reload', async ({
    context,
  }) => {
    const { pageA, pageB, checks } = await openWithSessionEndedInB(context);

    await signInThroughLoginPage(pageB, 'admin');

    await returnToTab(pageA, 'focus');
    await expect
      .poll(() => checks.statuses, { message: 'the checks of page A' })
      .toEqual([401, 200]);
    await expect(signInDialog(pageA)).toHaveCount(0);
    expect(
      await menuNames(pageA, account('admin').username),
      'the administrator is signed in on page A',
    ).toBe(true);
    expect(await windowMarked(pageA), 'page A was not reloaded').toBe(true);
    await expect(workers(pageA)).toBeVisible();
    expect(
      await coveredAt(pageA, workers(pageA)),
      'the staff data of page A is back and not covered',
    ).toBe(false);
  });

  test('another account signing in on the other tab loads the start page under that account on the next return', async ({
    context,
  }) => {
    const { pageA, pageB } = await openWithSessionEndedInB(context);

    await signInThroughLoginPage(pageB, 'viewer');

    const loaded = pageA.waitForEvent('load');
    await returnToTab(pageA, 'visibility');
    await loaded;

    await expect(pageA).toHaveURL(/\/ui\/status\/?$/);
    await expect(title(pageA, 'Status')).toBeVisible();
    await expect(pageA.locator(userMenu)).toBeVisible();
    await expect
      .poll(() => menuNames(pageA, account('viewer').username), {
        message: 'the viewer is signed in on page A',
      })
      .toBe(true);
    await expect(signInDialog(pageA)).toHaveCount(0);
    expect(await windowMarked(pageA), 'page A was loaded afresh').toBe(false);
  });

  test('signing in through the dialog of the returned tab closes it and keeps the page', async ({
    context,
  }) => {
    const { pageA } = await openWithSessionEndedInB(context);

    const dialog = signInDialog(pageA);
    await dialog.getByLabel('Password').fill(account('admin').password);
    await dialog.getByRole('button', { name: 'Log in' }).click();

    await expect(dialog).toHaveCount(0);
    await pageA.waitForLoadState('networkidle');
    await expect(dialog).toHaveCount(0);
    expect(await windowMarked(pageA), 'page A was not reloaded').toBe(true);
    await expect(workers(pageA)).toBeVisible();
  });
});
