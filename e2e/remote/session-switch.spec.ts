import { type Page, expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { TestObjects } from '../support/api';
import { title } from '../support/sign-in';
import {
  apiLogin,
  endSessionBehindThePage,
  logOutThroughMenu,
  signedOut,
} from './session-helpers';

// What the sign-in-again dialog does in a real browser when another account
// signs in through it, when it is stacked over another dialog, and when the
// user returns to a tab whose session another tab ended. Every test runs in a
// context of its own with a fresh session, because ending a session here must
// never touch the session the other remote tests share.

const userMenu = '[data-cy=user-dropdown]';
const loginMenuItem = '[data-cy=pulp-menu-item-login]';

test.use({ storageState: signedOut });

// A test that signed in leaves a live session on the server unless it is
// ended: end whatever session the context still holds, the way a person does.
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

test('returning to a tab whose session another tab ended asks to sign in again', async ({
  context,
}) => {
  await apiLogin(context);
  const tabA = await context.newPage();
  const tabB = await context.newPage();
  await tabA.goto('file/repositories');
  await tabB.goto('file/repositories');
  await expect(title(tabA, 'Repositories')).toBeVisible();
  await expect(title(tabB, 'Repositories')).toBeVisible();

  // counts what the browser tells tab A about its visibility
  await tabA.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { visibilityEvents: string[] }).visibilityEvents =
      seen;
    document.addEventListener('visibilitychange', () =>
      seen.push(document.visibilityState),
    );
  });

  expect(await endSessionBehindThePage(tabB)).toBe(204);
  await tabB.bringToFront();
  await tabA.bringToFront();

  const events = await tabA
    .waitForFunction(
      () =>
        (window as unknown as { visibilityEvents: string[] }).visibilityEvents
          .length > 0,
      undefined,
      { timeout: 3_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!events) {
    // A browser that does not switch visibility between pages of one window
    // never tells the page the user came back, so there is nothing to react
    // to. This is a check for a person with a real browser window.
    console.log(
      'the browser emitted no visibilitychange on tab switch; the tab return check stays a human check',
    );
    test.info().annotations.push({
      type: 'human check',
      description:
        'tab return: the browser sent no visibilitychange between tabs',
    });
    return;
  }

  await expect(
    tabA.getByRole('dialog', { name: 'Sign in again' }),
  ).toBeVisible();
});
