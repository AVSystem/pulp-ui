import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { storageStatePath } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
import { coveredAt } from '../support/session-cover';
import { title } from '../support/sign-in';

// Captures the surfaces of the session and permission handling on a deployed
// build, in both themes and at both widths, and runs axe on each. Every
// refusal, ended session and failed read is produced with page.route, so the
// build shows its own states on real data. A write that a test refuses is
// fulfilled locally and never leaves the browser; a guard registered before
// every other route aborts and reports any other write that would reach the
// server, and each test fails if one did. The only writes to the deployment are
// the two empty repositories of the run, made through the API and removed
// again.
//
// Besides the captures, the spec measures what a screenshot alone would leave
// to the eye: the width and position of the refused-action alert, the spacing
// of the sign-in dialog and of the add collection dialog, and where the text of
// the Status screen starts.
//
// The screenshots show a deployment's data and stay on the machine that ran
// the spec: they go to PULP_UI_SHELL_OUT (shell-report/ unless set), which is
// ignored by git. A file is SURFACE-STATE-THEME-VIEWPORT.png; the surface
// prefix (s1, s2, ...) only keeps the files of one run in a stable order.

const outDir = resolve(process.env['PULP_UI_SHELL_OUT'] ?? 'shell-report');

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const API = '/pulp/api/v3/';

// Made-up credentials: they only ever reach a route that answers locally.
const NO_SUCH_USER = 'zz-e2e-no-such-user';
const NO_SUCH_PASSWORD = 'zz-e2e-no-such-password';

const LANGUAGES = ['en', 'es', 'fr', 'ko', 'nl', 'ja', 'zh'];

const signedOut = { cookies: [], origins: [] };

// The server's own sentence for a refusal.
const REFUSED = 'You do not have permission to perform this action.';
const LONG_DETAIL = 'x'.repeat(500);
const MEDIUM_DETAIL = 'y'.repeat(200);

// A task address that no task answers to; its read is always answered locally.
const NO_SUCH_TASK = '00000000-0000-4000-8000-000000000001';

// The least space, in pixels, between two blocks of text that the spacing
// scale of the interface calls "medium".
const MEDIUM_GAP = 16;

interface IProject {
  theme: string;
  viewport: string;
}

const projectOf = (): IProject & { name: string } => {
  const { name, metadata } = test.info().project;
  return { name, ...(metadata as IProject) };
};

// Screenshots the page and fails on any serious or critical axe violation,
// colour contrast included, naming the rule and the elements.
async function capture(page: Page, state: string): Promise<void> {
  const { theme, viewport } = projectOf();
  mkdirSync(outDir, { recursive: true });
  // Menus and dialogs fade in; finite transitions are taken to their end.
  await page.screenshot({
    path: join(outDir, `${state}-${theme}-${viewport}.png`),
    animations: 'disabled',
  });
  const { violations } = await new AxeBuilder({ page })
    .withTags(AXE_TAGS)
    .analyze();
  const blocking = violations.filter(
    ({ impact }) => impact === 'serious' || impact === 'critical',
  );
  expect(
    blocking.map(({ id, impact, nodes }) => ({
      id,
      impact,
      targets: nodes.slice(0, 5).map((node) => node.target.join(' ')),
    })),
    `axe violations of ${state}`,
  ).toEqual([]);
}

// The page itself does not scroll sideways.
async function expectNoSideScroll(page: Page, what: string): Promise<void> {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  test.info().annotations.push({
    type: 'overflow',
    description: `${what}: scrollWidth ${scroll}, clientWidth ${client}`,
  });
  expect(scroll, `${what} scrolls sideways`).toBe(client);
}

interface IBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The bounding box of an element that must be on screen.
async function boxOf(locator: Locator, what: string): Promise<IBox> {
  const box = await locator.boundingBox();
  expect(box, `${what} has a box`).not.toBeNull();
  return box as IBox;
}

// The left edge of the text itself, not of the box that holds it, so two
// elements with different padding are compared by where a reader's eye starts.
async function textLeft(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return range.getBoundingClientRect().left;
  });
}

// The text starts at least one medium space inside the main area, which is the
// inset of the section frame that the other screens use, and the offset to the
// title (which has a larger inset of its own) is recorded.
async function expectInsideSectionFrame(
  page: Page,
  text: Locator,
): Promise<void> {
  const main = await boxOf(
    page.locator('.pf-v6-c-page__main'),
    'the main area',
  );
  const inset = (await textLeft(text)) - main.x;
  const heading = page.locator('h1', { hasText: 'Status' }).first();
  const titleInset = (await textLeft(heading)) - main.x;
  test.info().annotations.push({
    type: 'status text edge',
    description: `text ${Math.round(inset)}px, title ${Math.round(titleInset)}px from the main area`,
  });
  expect(Math.round(inset)).toBeGreaterThanOrEqual(MEDIUM_GAP);
}

// Waits for the finite transitions of the page (a dialog fading and moving in)
// to reach their end, so that a measurement does not catch a block half way.
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
}

// The space between the bottom of one block and the top of the next.
const gapBetween = (above: IBox, below: IBox): number =>
  below.y - (above.y + above.height);

// ---- routes -----------------------------------------------------------------

const isApi = (path: string) => (url: URL) => url.pathname === `${API}${path}`;

// Registered first, so every request that no later route answers lands here: a
// read goes on, any other request is aborted and recorded.
async function guardWrites(page: Page): Promise<{ leaked: string[] }> {
  const leaked: string[] = [];
  await page.route(
    (url) => url.pathname.startsWith('/pulp/api/'),
    async (route) => {
      const method = route.request().method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
        return route.fallback();
      }
      leaked.push(`${method} ${new URL(route.request().url()).pathname}`);
      return route.abort();
    },
  );
  return { leaked };
}

// Answers every request with the method to the address locally.
async function answer(
  page: Page,
  method: string,
  matches: (url: URL) => boolean,
  status: number,
  json: unknown,
): Promise<void> {
  await page.route(matches, async (route) =>
    route.request().method() === method
      ? route.fulfill({ status, json })
      : route.fallback(),
  );
}

// Serves the build's own configuration with the external login address added.
async function useExternalLogin(
  page: Page,
  address = '/stand-in-login/',
): Promise<void> {
  await page.route('**/pulp-ui-config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      response,
      json: { ...config, UI_EXTERNAL_LOGIN_URI: address },
    });
  });
}

// Plays an external login service that sends the visitor back with no session.
async function useReturnWithoutSession(page: Page): Promise<void> {
  await page.route('**/stand-in-login/**', async (route) => {
    const next = new URL(route.request().url()).searchParams.get('next');
    await route.fulfill({ status: 302, headers: { location: next ?? '/' } });
  });
}

// Opens the sidebar where it is a drawer.
async function openSidebar(page: Page): Promise<void> {
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) {
    await open.click();
    await expect(page.locator('#page-sidebar')).toHaveCSS('opacity', '1');
  }
}

// ---- test objects -------------------------------------------------------------

let objects: TestObjects;
let fileRepository: PulpObject;
let ansibleRepository: PulpObject;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  // One scope per project: the clean-up of a project removes everything under
  // its scope's prefix, so the projects that run side by side must not share one.
  const { theme, viewport } = projectOf();
  objects = await TestObjects.open(`states-${theme}-${viewport}`);
  fileRepository = await objects.create('repositories/file/file/', {
    name: objects.name('file'),
  });
  ansibleRepository = await objects.create('repositories/ansible/ansible/', {
    name: objects.name('ansible'),
  });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await objects.cleanUp();
});

// Every test checks that nothing was written to the server.
let guard: { leaked: string[] };

test.beforeEach(async ({ page }) => {
  guard = await guardWrites(page);
});

test.afterEach(() => {
  expect(guard.leaked, 'writes that would have reached the server').toEqual([]);
});

// ---- insufficient permissions page --------------------------------------------

// Answers every read of the address with 403, with Pulp's reason when given.
const refuseRead = (
  page: Page,
  matches: (url: URL) => boolean,
  detail?: string,
) =>
  page.route(matches, async (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 403,
          json: detail === undefined ? {} : { detail },
        })
      : route.fallback(),
  );

const refuseFileList = (page: Page, detail?: string) =>
  refuseRead(page, isApi('repositories/file/file/'), detail);

test.describe('insufficient permissions page', () => {
  test('a refused page read shows the page with Pulp reason @phone', async ({
    page,
  }) => {
    await refuseFileList(page, REFUSED);
    await page.goto('file/repositories');

    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await expect(page.getByText(REFUSED)).toBeVisible();
    await capture(page, 's2-refused-read');
  });

  test('a refused page read without a server text shows the page without a reason', async ({
    page,
  }) => {
    await refuseFileList(page);
    await page.goto('file/repositories');

    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await capture(page, 's2-refused-read-no-detail');
  });

  test('a refused task list read shows the page under the task list header @phone', async ({
    page,
  }) => {
    await refuseRead(page, isApi('tasks/'), REFUSED);
    await page.goto('tasks');

    await expect(
      page.locator('h1', { hasText: 'Task management' }),
    ).toBeVisible();
    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await expect(page.getByText(REFUSED)).toBeVisible();
    // no toolbar, table or maintenance control is drawn for a refused read
    await expect(
      page.getByRole('button', {
        name: /^(Orphan cleanup|Repair|Purge tasks|Stop task)/,
      }),
    ).toHaveCount(0);
    await expect(page.getByRole('table')).toHaveCount(0);
    await capture(page, 's2-task-list-refused');
  });

  test('a refused task read shows the page under the task detail header @phone', async ({
    page,
  }) => {
    await refuseRead(
      page,
      (url) => url.pathname === `${API}tasks/${NO_SUCH_TASK}/`,
      REFUSED,
    );
    await page.goto(`tasks/${NO_SUCH_TASK}`);

    await expect(page.locator('h1', { hasText: 'Task detail' })).toBeVisible();
    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await expect(page.getByText(REFUSED)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Stop task/ })).toHaveCount(
      0,
    );
    await capture(page, 's2-task-detail-refused');
  });

  test('an unbroken server text of 500 and of 200 characters wraps at 360px @phone-only', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 844 });
    for (const [kind, detail] of [
      ['500', LONG_DETAIL],
      ['200', MEDIUM_DETAIL],
    ] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      guard = await guardWrites(page);
      await refuseFileList(page, detail);
      await page.goto('file/repositories');
      await expect(page.getByText(detail)).toBeVisible();
      await expectNoSideScroll(
        page,
        `insufficient permissions with ${kind} characters`,
      );
      await capture(page, `s2-unbroken-${kind}-360`);
    }
  });

  test.describe('as the limited account', () => {
    test.use({ storageState: storageStatePath('viewer') });

    test('an administration screen opened by its address has its page header @phone', async ({
      page,
    }) => {
      await page.goto('users');

      await expect(
        page.locator('h1', { hasText: 'Insufficient permissions' }).first(),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
      await capture(page, 's2-administration-screen-limited-account');

      // the roles list is an administration screen too
      await page.goto('roles');
      await expect(
        page.locator('h1', { hasText: 'Insufficient permissions' }).first(),
      ).toBeVisible();
    });

    test('a list screen offers no header action, row action or actions column', async ({
      page,
    }) => {
      await page.goto('file/repositories');
      await expect(title(page, 'Repositories')).toBeVisible();
      await page.waitForLoadState('networkidle');

      await expect(
        page.getByRole('button', {
          name: /^(Add .+|Create .+|Edit|Sync|Delete|Remove|Upload .+|Import .+)$/,
        }),
      ).toHaveCount(0);
      await expect(page.locator('[data-cy=kebab-toggle]')).toHaveCount(0);
      await expect(
        page.locator('tbody td[style*="justify-content: flex-end"]'),
      ).toHaveCount(0);
      await capture(page, 's4-list-limited-account');
    });
  });

  test.describe('signed out', () => {
    test.use({ storageState: signedOut });

    test('a protected screen opened without a session leads to Login', async ({
      page,
    }) => {
      await page.goto('file/repositories');

      await expect(page).toHaveURL(/\/login/);
      await capture(page, 's2-signed-out-leads-to-login');
    });

    test('the Status screen of a visitor whose status read is refused', async ({
      page,
    }) => {
      await page.route(isApi('status/'), async (route) =>
        route.request().method() === 'GET'
          ? route.fulfill({ status: 403, json: { detail: REFUSED } })
          : route.fallback(),
      );
      await page.goto('status');

      await expect(page.getByText('Failed to load status')).toBeVisible();
      await capture(page, 's2-signed-out-status-refused');
    });
  });
});

// ---- sign in again dialog -----------------------------------------------------

// Opens the edit form of the run's file repository and types into it.
async function typeIntoEditForm(page: Page): Promise<void> {
  await page.goto(`file/repositories/edit/${fileRepository.name as string}`);
  await expect(page.locator('#description')).toBeVisible();
  await page
    .locator('#description')
    .fill('Notes typed before the session ended');
}

const saveAddress = (): ((url: URL) => boolean) => (url) =>
  url.pathname === fileRepository.pulp_href;

// Presses Save on the form while the server answers the write with the status;
// the answer is given locally.
async function saveRefusedWith(
  page: Page,
  status: number,
  json: unknown,
): Promise<void> {
  await answer(page, 'PATCH', saveAddress(), status, json);
  await page.getByRole('button', { name: 'Save' }).click();
}

test.describe('sign in again dialog', () => {
  test('over an edit form with typed content, spaced and keeping the form @phone', async ({
    page,
  }) => {
    await typeIntoEditForm(page);
    await saveRefusedWith(page, 401, { detail: 'Not authenticated.' });

    const dialog = page.getByRole('dialog', { name: 'Sign in again' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText('What you have entered on this page is kept.'),
    ).toBeVisible();
    await expect(page.locator('#description')).toHaveValue(
      'Notes typed before the session ended',
    );
    // The form stays mounted below the dialog, but nothing of it can be read
    // through the layer under the dialog.
    expect(
      await coveredAt(page, page.locator('#description')),
      'the form field behind the dialog is covered by the opaque layer',
    ).toBe(true);

    // The lead sentence, the request note and the kept note are one medium
    // space apart, and so is the last of them from the first field.
    await settle(page);
    const paragraphs = dialog.locator('p');
    expect(await paragraphs.count()).toBeGreaterThanOrEqual(3);
    const boxes: IBox[] = [];
    for (let index = 0; index < (await paragraphs.count()); index += 1) {
      boxes.push(await boxOf(paragraphs.nth(index), `paragraph ${index + 1}`));
    }
    const username = await boxOf(
      dialog.locator('label', { hasText: 'Username' }).first(),
      'the Username label',
    );
    // each block against the next one; the last against the first field
    const following = [...boxes.slice(1), username];
    const gaps = boxes.map((box, index) =>
      gapBetween(box, following[index] as IBox),
    );
    test.info().annotations.push({
      type: 'dialog gaps',
      description: gaps.map((gap) => `${Math.round(gap)}px`).join(', '),
    });
    for (const gap of gaps) {
      expect(Math.round(gap)).toBeGreaterThanOrEqual(MEDIUM_GAP);
    }
    await capture(page, 's1-form-mode');
  });

  test('with an error line after a failed sign-in', async ({ page }) => {
    await typeIntoEditForm(page);
    await saveRefusedWith(page, 401, { detail: 'Not authenticated.' });
    const dialog = page.getByRole('dialog', { name: 'Sign in again' });
    await expect(dialog).toBeVisible();

    await answer(page, 'POST', isApi('login/'), 401, {
      detail: 'Invalid username or password.',
    });
    await dialog.getByLabel('Username').fill(NO_SUCH_USER);
    await dialog.getByLabel('Password').fill(NO_SUCH_PASSWORD);
    await dialog.getByRole('button', { name: 'Log in' }).click();

    await expect(dialog.getByText(/invalid/i).first()).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(
      await coveredAt(page, page.locator('#description')),
      'the form field behind the dialog is covered by the opaque layer',
    ).toBe(true);
    await capture(page, 's1-error-line');
  });

  test('in external login mode offers a Login button and no form @phone', async ({
    page,
  }) => {
    await useExternalLogin(page);
    await typeIntoEditForm(page);
    await saveRefusedWith(page, 401, { detail: 'Not authenticated.' });

    const dialog = page.getByRole('dialog', { name: 'Sign in again' });
    await expect(dialog).toBeVisible();
    await expect(
      dialog
        .getByRole('link', { name: 'Login' })
        .or(dialog.getByRole('button', { name: 'Login' })),
    ).toBeVisible();
    await expect(dialog.getByLabel('Password')).toHaveCount(0);
    expect(
      await coveredAt(
        page,
        page.getByRole('heading', { level: 1, includeHidden: true }).first(),
      ),
      'the page title behind the dialog is covered by the opaque layer',
    ).toBe(true);
    await capture(page, 's1-external-mode');
  });
});

// ---- refused action alert -----------------------------------------------------

// Deletes the run's file repository from its list row while the server answers
// the delete with 403 and the given text; the answer is given locally, so the
// repository stays.
async function deleteRefusedWith(page: Page, detail: string): Promise<Locator> {
  await answer(page, 'DELETE', saveAddress(), 403, { detail });
  await page.goto(
    `file/repositories?name__icontains=${fileRepository.name as string}`,
  );
  const kebab = page.locator('[data-cy=kebab-toggle] button').first();
  await expect(kebab).toBeVisible();
  await kebab.click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // the confirmation asks for the repository name before it enables Delete
  await dialog
    .getByRole('textbox', { name: /confirm/i })
    .fill(fileRepository.name as string);
  await dialog.getByRole('button', { name: /^(Delete|Remove)$/ }).click();
  return dialog;
}

// Adds a collection version to the run's ansible repository from the dialog
// while the server answers the add with 403 and the given text; the answer is
// given locally.
async function addCollectionRefusedWith(
  page: Page,
  detail: string,
): Promise<void> {
  await serveCollections(page, [2, 5, 6, 9], 'answer');
  await answer(
    page,
    'POST',
    (url) => url.pathname === `${ansibleRepository.pulp_href}modify/`,
    403,
    { detail },
  );
  const dialog = await openAddCollection(page);
  const row = dialog.getByRole('checkbox', { disabled: false }).first();
  await expect(row).toBeEnabled();
  await row.check();
  await dialog.getByRole('button', { name: 'Select', exact: true }).click();
}

const refusalAlert = (page: Page, detail: string): Locator =>
  page.locator('[data-cy=AlertList]').filter({ hasText: detail });

test.describe('refused action alert', () => {
  for (const [kind, detail] of [
    ['short', REFUSED],
    ['very-long', LONG_DETAIL],
  ] as const) {
    test(`an add collection refused with a ${kind} server text shows the alert`, async ({
      page,
    }) => {
      await addCollectionRefusedWith(page, detail);

      const alert = refusalAlert(page, detail);
      await expect(alert).toBeVisible();
      await expect(
        alert.getByText('You do not have permission to do this.'),
      ).toBeVisible();
      await settle(page);
      const box = await boxOf(alert, 'the alert');
      test.info().annotations.push({
        type: 'alert box',
        description: `${kind}: x ${Math.round(box.x)}, width ${Math.round(box.width)}`,
      });

      // The alert starts right of the sidebar, ends inside the window and is
      // no wider than a toast alert, however long the unbroken text is.
      const sidebar = await boxOf(page.locator('#page-sidebar'), 'the sidebar');
      const { innerWidth, rootFont } = await page.evaluate(() => ({
        innerWidth: window.innerWidth,
        rootFont: parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ),
      }));
      const bound = Math.min(37.5 * rootFont, innerWidth - 10);
      expect(
        box.x,
        'the alert starts right of the sidebar',
      ).toBeGreaterThanOrEqual(sidebar.x + sidebar.width);
      expect(
        box.x + box.width,
        'the alert ends inside the window',
      ).toBeLessThanOrEqual(innerWidth);
      expect(
        Math.round(box.width),
        'the alert is no wider than its bound',
      ).toBeLessThanOrEqual(Math.round(bound));
      await capture(page, `s3-alert-${kind}`);
    });
  }

  test('an unbroken server text of 500 and of 200 characters wraps at 360px @phone-only', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 844 });
    for (const [kind, detail] of [
      ['500', LONG_DETAIL],
      ['200', MEDIUM_DETAIL],
    ] as const) {
      await addCollectionRefusedWith(page, detail);
      const alert = refusalAlert(page, detail);
      await expect(alert).toBeVisible();
      await expectNoSideScroll(
        page,
        `refused action alert with ${kind} characters`,
      );
      const box = await boxOf(alert, 'the alert');
      test.info().annotations.push({
        type: 'alert box',
        description: `${kind} characters: x ${Math.round(box.x)}, width ${Math.round(box.width)} of 360`,
      });
      await capture(page, `s3-unbroken-${kind}-360`);
    }
  });

  test('a refused delete of a repository without distributions says it was not removed, inside its dialog', async ({
    page,
  }) => {
    const dialog = await deleteRefusedWith(page, REFUSED);

    await expect(
      dialog.getByText('The repository was not removed.'),
    ).toBeVisible();
    await expect(dialog.getByText(/distributions were removed/)).toHaveCount(0);
    await expect(dialog.getByText(REFUSED)).toBeVisible();
    await capture(page, 's3-delete-refused-in-dialog');
  });

  test('a refused save of a form is shown as three parts under the form', async ({
    page,
  }) => {
    await typeIntoEditForm(page);
    await saveRefusedWith(page, 403, { detail: REFUSED });

    // what happened, Pulp's reason and whom to ask, in one block of text
    const message = page.locator('p.pulp-break-anywhere', {
      hasText: REFUSED,
    });
    await expect(message).toBeVisible();
    await expect(message).toContainText(
      'You do not have permission to do this.',
    );
    await expect(message).toContainText(
      'Contact your organization administrator for more information.',
    );
    await capture(page, 's3-form-save-refused');
  });
});

// ---- plugin list failed -------------------------------------------------------

// Fails every read of the status document, where the plugin list comes from.
// While `held` is set the answer waits until it is released.
async function failPluginList(page: Page): Promise<{
  hold: () => void;
  release: () => void;
}> {
  let release: () => void = () => undefined;
  let gate: Promise<void> | null = null;
  await page.route(isApi('status/'), async (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    if (gate) {
      await gate;
    }
    return route.fulfill({ status: 500, json: { detail: 'Failed.' } });
  });
  return {
    hold: () => {
      gate = new Promise<void>((resolveGate) => {
        release = resolveGate;
      });
    },
    release: () => {
      release();
      gate = null;
    },
  };
}

const errorRow = (page: Page): Locator => page.locator('.pulp-menu__error');

async function showErrorRow(page: Page): Promise<Locator> {
  await page.goto('about');
  await openSidebar(page);
  // the first failure is retried quietly after three seconds
  await expect(errorRow(page)).toBeVisible({ timeout: 20_000 });
  return errorRow(page);
}

test.describe('plugin list row', () => {
  test('the row with Retry @phone', async ({ page }) => {
    await failPluginList(page);
    const row = await showErrorRow(page);

    await expect(
      row.getByText('The plugin list could not be loaded'),
    ).toBeVisible();
    await expect(
      row.getByRole('button', { name: 'Retry loading the plugin list' }),
    ).toBeVisible();
    await capture(page, 's5-row');
  });

  test('Retry while loading is disabled @phone', async ({ page }) => {
    const reads = await failPluginList(page);
    const row = await showErrorRow(page);

    reads.hold();
    const retry = row.getByRole('button', {
      name: 'Retry loading the plugin list',
    });
    await retry.click();
    await expect(retry).toHaveAttribute('aria-disabled', 'true');
    await capture(page, 's5-retry-loading');
    reads.release();
  });

  test('the row in every installed language at 360px keeps Retry visible and is translated @phone-only', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 360, height: 844 });
    await failPluginList(page);

    let longest = { language: 'en', length: 0 };
    const texts: Record<string, string> = {};
    for (const language of LANGUAGES) {
      await page.goto(`about?lang=${language}`);
      await openSidebar(page);
      const row = errorRow(page);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const retry = row.getByRole('button', { name: /.+/ });
      await expect(retry).toBeVisible();
      const box = await boxOf(retry, `Retry of ${language}`);
      expect(box.x + box.width).toBeLessThanOrEqual(360);
      const { scroll, client } = await row.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(scroll, `the row in ${language} overflows`).toBeLessThanOrEqual(
        client,
      );
      const text = ((await row.textContent()) ?? '').trim();
      texts[language] = text;
      if (language !== 'en') {
        expect(text, `the row in ${language} is translated`).not.toBe(
          texts['en'],
        );
      }
      test.info().annotations.push({
        type: 'plugin list row',
        description: `${language}: ${text.length} characters, ${client}px wide`,
      });
      if (text.length > longest.length) {
        longest = { language, length: text.length };
      }
    }

    await page.goto(`about?lang=${longest.language}`);
    await openSidebar(page);
    await expect(errorRow(page)).toBeVisible({ timeout: 20_000 });
    await capture(page, `s5-row-longest-${longest.language}-360`);
    await page.goto('about?lang=');
  });

  test('the row in every installed language at the sidebar width keeps Retry visible and is translated', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await failPluginList(page);

    let longest = { language: 'en', length: 0 };
    const texts: Record<string, string> = {};
    for (const language of LANGUAGES) {
      await page.goto(`about?lang=${language}`);
      const row = errorRow(page);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const retry = row.getByRole('button', { name: /.+/ });
      await expect(retry).toBeVisible();
      const sidebar = await boxOf(page.locator('#page-sidebar'), 'the sidebar');
      const box = await boxOf(retry, `Retry of ${language}`);
      expect(box.x + box.width).toBeLessThanOrEqual(sidebar.x + sidebar.width);
      const { scroll, client } = await row.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(scroll, `the row in ${language} overflows`).toBeLessThanOrEqual(
        client,
      );
      const text = ((await row.textContent()) ?? '').trim();
      texts[language] = text;
      if (language !== 'en') {
        expect(text, `the row in ${language} is translated`).not.toBe(
          texts['en'],
        );
      }
      test.info().annotations.push({
        type: 'plugin list row',
        description: `${language}: ${text.length} characters, sidebar ${Math.round(sidebar.width)}px, row ${client}px`,
      });
      if (text.length > longest.length) {
        longest = { language, length: text.length };
      }
    }

    await page.goto(`about?lang=${longest.language}`);
    await expect(errorRow(page)).toBeVisible({ timeout: 20_000 });
    await capture(page, `s5-row-longest-${longest.language}`);
    await page.goto('about?lang=');
  });
});

// ---- signed out page, sign-in did not complete, session could not be checked --

test.describe('signed out page', () => {
  test.use({ storageState: signedOut });

  test('in external login mode it stands alone, without the application shell @phone', async ({
    page,
  }) => {
    await useExternalLogin(page);
    await page.goto('signed-out');

    await expect(title(page, 'Signed out')).toBeVisible();
    await expect(
      page.getByText('You have been signed out of Pulp.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Sign in again' }),
    ).toBeVisible();
    // no masthead and no sidebar: the page is not drawn inside the shell. The
    // login frame's own header (the logo, no control) is the only banner.
    await expect(page.locator('.pf-v6-c-masthead')).toHaveCount(0);
    await expect(page.locator('#page-sidebar')).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await expect(
      page
        .getByRole('banner')
        .getByRole('link')
        .or(page.getByRole('banner').getByRole('button')),
    ).toHaveCount(0);
    await capture(page, 's6-signed-out');
  });
});

test.describe('sign-in did not complete', () => {
  test.use({ storageState: signedOut });

  test('a return from the external login without a session says so @phone', async ({
    page,
  }) => {
    await useExternalLogin(page);
    await useReturnWithoutSession(page);
    await page.goto('tasks');

    await expect(page.getByText('Sign-in did not complete')).toBeVisible();
    await expect(
      page.getByText('The login page returned without a signed-in session.'),
    ).toBeVisible();
    await capture(page, 's9-sign-in-did-not-complete');
  });
});

test.describe('session could not be checked', () => {
  test('a session check that fails offers Retry @phone', async ({ page }) => {
    await page.route(isApi('login/'), async (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 500, json: { detail: 'Failed.' } })
        : route.fallback(),
    );
    await page.goto('tasks');

    await expect(
      page.getByText('The session could not be checked'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
    await capture(page, 's10-session-not-checked');
  });
});

// ---- before sign in and the Status screen -------------------------------------

test.describe('before sign in', () => {
  test.use({ storageState: signedOut });

  test('the Status screen and the sidebar of a visitor @phone', async ({
    page,
  }) => {
    await page.goto('status');

    const note = page.getByText(
      'Versions, workers and storage are shown to signed-in users.',
    );
    await expect(note).toBeVisible();
    await page.waitForLoadState('networkidle');

    // the note sits inside the section frame of the other screens, not flush
    // against the sidebar, and a reduced answer has no raw JSON panel
    await expectInsideSectionFrame(page, note);
    await expect(page.getByRole('button', { name: 'JSON' })).toHaveCount(0);
    await capture(page, 's7-status-anonymous');

    await openSidebar(page);
    const sidebar = page.getByRole('navigation', { name: 'Main' });
    await expect(sidebar.getByRole('link', { name: 'Login' })).toBeVisible();
    await expect(
      sidebar.getByRole('link', { name: /Workers and status/ }),
    ).toHaveCount(0);
    await capture(page, 's7-sidebar-signed-out');
  });
});

test.describe('Status screen of a signed-in account that is not an administrator', () => {
  test.use({ storageState: storageStatePath('viewer') });

  test('shows the versions and the administrators note, without workers', async ({
    page,
  }) => {
    await page.goto('status');

    const note = page.getByText(
      'Workers, storage and content settings are shown to administrators.',
    );
    await expect(note).toBeVisible();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Online workers')).toHaveCount(0);
    await expect(page.getByText('Versions').first()).toBeVisible();

    await expectInsideSectionFrame(page, note);
    await capture(page, 's7-status-viewer');
  });
});

// ---- add collection dialog ----------------------------------------------------

const COLLECTION_VERSIONS = 'content/ansible/collection_versions/';

const collectionVersion = (index: number) => ({
  pulp_href: `${API}content/ansible/collection_versions/0000000${index}-0000-4000-8000-000000000000/`,
  namespace: `example${index}`,
  name: `collection${index}`,
  version: `1.${index}.0`,
  description:
    index % 3 === 0
      ? 'A longer description that explains what this made-up collection is for and who maintains it.'
      : `Made-up collection number ${index}`,
});

// Serves the dialog's list with ten rows on its first page and answers the
// content read for the page with the versions at the given places (or fails it).
async function serveCollections(
  page: Page,
  held: number[],
  contentRead: 'answer' | 'fail',
): Promise<void> {
  const rows = Array.from({ length: 10 }, (_, index) =>
    collectionVersion(index + 1),
  );
  await page.route(
    (url) => url.pathname === `${API}${COLLECTION_VERSIONS}`,
    async (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      const query = new URL(route.request().url()).searchParams;
      if (query.has('pulp_href__in')) {
        if (contentRead === 'fail') {
          return route.fulfill({ status: 500, json: { detail: 'Failed.' } });
        }
        const results = rows.filter((_, index) => held.includes(index + 1));
        return route.fulfill({
          json: { count: results.length, next: null, previous: null, results },
        });
      }
      if (query.has('repository_version')) {
        return route.fallback();
      }
      return route.fulfill({
        json: { count: 23, next: null, previous: null, results: rows },
      });
    },
  );
}

async function openAddCollection(page: Page): Promise<Locator> {
  await page.goto(
    `ansible/repositories/detail/${ansibleRepository.name as string}?tab=collection-versions`,
  );
  await expect(title(page, ansibleRepository.name as string)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Add collection' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Select a collection');
  return dialog;
}

test.describe('add collection dialog', () => {
  test('marked rows on a page of ten', async ({ page }) => {
    await serveCollections(page, [2, 5, 6, 9], 'answer');
    const dialog = await openAddCollection(page);

    await expect(dialog.getByText('In repository')).toHaveCount(4);
    await expect(dialog.getByRole('checkbox', { disabled: true })).toHaveCount(
      4,
    );
    await expect(dialog.getByRole('row')).toHaveCount(11);
    await capture(page, 's8-marked-rows');
  });

  test('a failed content read shows an alert clear of the toolbar', async ({
    page,
  }) => {
    await serveCollections(page, [], 'fail');
    const dialog = await openAddCollection(page);

    await expect(
      dialog.getByText('The repository content could not be read'),
    ).toBeVisible();
    await settle(page);
    const alert = await boxOf(
      dialog.locator('.pulp-collection-read-failed'),
      'the alert',
    );
    const toolbar = await boxOf(
      dialog.locator('.pf-v6-c-toolbar').first(),
      'the toolbar',
    );
    const gap = gapBetween(alert, toolbar);
    test.info().annotations.push({
      type: 'alert to toolbar',
      description: `${Math.round(gap)}px`,
    });
    expect(Math.round(gap)).toBeGreaterThanOrEqual(MEDIUM_GAP);
    await capture(page, 's8-read-failed');
  });
});
