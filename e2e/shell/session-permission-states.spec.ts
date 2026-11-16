import AxeBuilder from '@axe-core/playwright';
import { type Locator, type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { storageStatePath } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
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
// The screenshots show a deployment's data and stay on the machine that ran
// the spec: they go to PULP_UI_SHELL_OUT (shell-report/ unless set), which is
// ignored by git. A file is SURFACE-STATE-THEME-VIEWPORT.png.

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

// ---- S2: insufficient permissions page ---------------------------------------

const refuseFileList = (page: Page, detail?: string) =>
  page.route(isApi('repositories/file/file/'), async (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({
          status: 403,
          json: detail === undefined ? {} : { detail },
        })
      : route.fallback(),
  );

test.describe('S2 insufficient permissions', () => {
  test('S2 a refused page read @phone', async ({ page }) => {
    await refuseFileList(page, REFUSED);
    await page.goto('file/repositories');

    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await expect(page.getByText(REFUSED)).toBeVisible();
    await capture(page, 's2-refused-read');
  });

  test('S2 a refused page read without a server text', async ({ page }) => {
    await refuseFileList(page);
    await page.goto('file/repositories');

    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await capture(page, 's2-refused-read-no-detail');
  });

  test('S2 an unbroken server text of 500 and of 200 characters wraps at 360px @phone-only', async ({
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
      await expectNoSideScroll(page, `S2 with ${kind} characters`);
      await capture(page, `s2-unbroken-${kind}-360`);
    }
  });

  test.describe('as the limited account', () => {
    test.use({ storageState: storageStatePath('viewer') });

    test('S2 an administration screen opened by its address @phone', async ({
      page,
    }) => {
      await page.goto('users');

      await expect(title(page, 'Insufficient permissions')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
      await capture(page, 's2-administration-screen-limited-account');
    });

    test('S4 a list screen offers no header action, row action or actions column', async ({
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

// ---- S1: sign in again --------------------------------------------------------

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

test.describe('S1 sign in again', () => {
  test('S1 over an edit form with typed content @phone', async ({ page }) => {
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
    await capture(page, 's1-form-mode');
  });

  test('S1 with an error line', async ({ page }) => {
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
    await capture(page, 's1-error-line');
  });

  test('S1 in external login mode @phone', async ({ page }) => {
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
    await capture(page, 's1-external-mode');
  });
});

// ---- S3: refused action alert -------------------------------------------------

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

test.describe('S3 refused action', () => {
  for (const [kind, detail] of [
    ['short', REFUSED],
    ['very-long', LONG_DETAIL],
  ] as const) {
    test(`S3 alert with a ${kind} server text`, async ({ page }) => {
      await addCollectionRefusedWith(page, detail);

      const alert = refusalAlert(page, detail);
      await expect(alert).toBeVisible();
      await expect(
        alert.getByText('You do not have permission to do this.'),
      ).toBeVisible();
      const box = await alert.boundingBox();
      test.info().annotations.push({
        type: 'alert box',
        description: `S3 ${kind}: x ${Math.round(box?.x ?? 0)}, width ${Math.round(box?.width ?? 0)}`,
      });
      await capture(page, `s3-alert-${kind}`);
    });
  }

  test('S3 an unbroken server text of 500 and of 200 characters wraps at 360px @phone-only', async ({
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
      await expectNoSideScroll(page, `S3 with ${kind} characters`);
      const box = await alert.boundingBox();
      test.info().annotations.push({
        type: 'alert box',
        description: `S3 with ${kind} characters: x ${Math.round(box?.x ?? 0)}, width ${Math.round(box?.width ?? 0)} of 360`,
      });
      await capture(page, `s3-unbroken-${kind}-360`);
    }
  });

  test('S3 a refused delete is shown inside its confirmation dialog', async ({
    page,
  }) => {
    const dialog = await deleteRefusedWith(page, REFUSED);

    await expect(dialog.getByText(REFUSED)).toBeVisible();
    await capture(page, 's3-delete-refused-in-dialog');
  });

  test('S3 a refused save of a form is shown inside the form', async ({
    page,
  }) => {
    await typeIntoEditForm(page);
    await saveRefusedWith(page, 403, { detail: REFUSED });

    await expect(page.getByText(REFUSED)).toBeVisible();
    await capture(page, 's3-form-save-refused');
  });
});

// ---- S5: plugin list failed ---------------------------------------------------

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

test.describe('S5 plugin list failed', () => {
  test('S5 the row with Retry @phone', async ({ page }) => {
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

  test('S5 Retry while loading @phone', async ({ page }) => {
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

  test('S5 the row in every installed language at 360px keeps Retry visible @phone-only', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 360, height: 844 });
    await failPluginList(page);

    let longest = { language: 'en', length: 0 };
    for (const language of LANGUAGES) {
      await page.goto(`about?lang=${language}`);
      await openSidebar(page);
      const row = errorRow(page);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const retry = row.getByRole('button', { name: /.+/ });
      await expect(retry).toBeVisible();
      const box = await retry.boundingBox();
      expect(box, `Retry of ${language} has a box`).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(360);
      const { scroll, client } = await row.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(scroll, `the row in ${language} overflows`).toBeLessThanOrEqual(
        client,
      );
      const length = ((await row.textContent()) ?? '').length;
      test.info().annotations.push({
        type: 'S5 row',
        description: `${language}: ${length} characters, ${client}px wide`,
      });
      if (length > longest.length) {
        longest = { language, length };
      }
    }

    await page.goto(`about?lang=${longest.language}`);
    await openSidebar(page);
    await expect(errorRow(page)).toBeVisible({ timeout: 20_000 });
    await capture(page, `s5-row-longest-${longest.language}-360`);
    await page.goto('about?lang=');
  });

  test('S5 the row in every installed language at the sidebar width keeps Retry visible', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await failPluginList(page);

    let longest = { language: 'en', length: 0 };
    for (const language of LANGUAGES) {
      await page.goto(`about?lang=${language}`);
      const row = errorRow(page);
      await expect(row).toBeVisible({ timeout: 20_000 });

      const retry = row.getByRole('button', { name: /.+/ });
      await expect(retry).toBeVisible();
      const sidebar = await page.locator('#page-sidebar').boundingBox();
      const box = await retry.boundingBox();
      expect(box).not.toBeNull();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
        (sidebar?.x ?? 0) + (sidebar?.width ?? 0),
      );
      const { scroll, client } = await row.evaluate((element) => ({
        scroll: element.scrollWidth,
        client: element.clientWidth,
      }));
      expect(scroll, `the row in ${language} overflows`).toBeLessThanOrEqual(
        client,
      );
      const length = ((await row.textContent()) ?? '').length;
      test.info().annotations.push({
        type: 'S5 row',
        description: `${language}: ${length} characters, sidebar ${Math.round(sidebar?.width ?? 0)}px, row ${client}px`,
      });
      if (length > longest.length) {
        longest = { language, length };
      }
    }

    await page.goto(`about?lang=${longest.language}`);
    await expect(errorRow(page)).toBeVisible({ timeout: 20_000 });
    await capture(page, `s5-row-longest-${longest.language}`);
    await page.goto('about?lang=');
  });
});

// ---- S6, S9, S10: pages of the external login mode and of a failed check ------

test.describe('S6 signed out page', () => {
  test.use({ storageState: signedOut });

  test('S6 signed out in external login mode @phone', async ({ page }) => {
    await useExternalLogin(page);
    await page.goto('signed-out');

    await expect(title(page, 'Signed out')).toBeVisible();
    await expect(
      page.getByText('You have been signed out of Pulp.'),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Sign in again' }),
    ).toBeVisible();
    await capture(page, 's6-signed-out');
  });
});

test.describe('S9 sign-in did not complete', () => {
  test.use({ storageState: signedOut });

  test('S9 a return from the external login without a session @phone', async ({
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

test.describe('S10 the session could not be checked', () => {
  test('S10 a session check that fails @phone', async ({ page }) => {
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

// ---- S7: before sign in -------------------------------------------------------

test.describe('S7 before sign in', () => {
  test.use({ storageState: signedOut });

  test('S7 the Status screen and the sidebar of a visitor @phone', async ({
    page,
  }) => {
    await page.goto('status');

    await expect(
      page.getByText(
        'Versions, workers and storage are shown to signed-in users.',
      ),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
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

// ---- S8: Add collection dialog ------------------------------------------------

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

test.describe('S8 Add collection dialog', () => {
  test('S8 marked rows on a page of ten', async ({ page }) => {
    await serveCollections(page, [2, 5, 6, 9], 'answer');
    const dialog = await openAddCollection(page);

    await expect(dialog.getByText('In repository')).toHaveCount(4);
    await expect(dialog.getByRole('checkbox', { disabled: true })).toHaveCount(
      4,
    );
    await expect(dialog.getByRole('row')).toHaveCount(11);
    await capture(page, 's8-marked-rows');
  });

  test('S8 the content read failed', async ({ page }) => {
    await serveCollections(page, [], 'fail');
    const dialog = await openAddCollection(page);

    await expect(
      dialog.getByText('The repository content could not be read'),
    ).toBeVisible();
    await capture(page, 's8-read-failed');
  });
});
