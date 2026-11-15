import {
  type Locator,
  type Page,
  type Route,
  expect,
  test,
} from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { submitLoginForm } from '../support/sign-in';

// Opens the shell states and overlays that need a click (menus, dialogs, the
// sign-in error line, an empty list), screenshots each, and closes it again.
// Nothing here changes the server: a delete confirmation is only opened, its
// danger button is checked for and never pressed, no form is saved, and the one
// submit is a sign-in with a user name and password that cannot exist.
//
// The shell states that depend on counts, notifications and search results
// (task pills, notification panel, palette) are rendered from fixtures that
// page.route serves for the shell's own read requests, with made-up names, so
// the screenshots are stable whatever the deployment holds and nothing is
// written to it. The layout checks write no screenshot.
//
// Run it against the same deployment before and after a change of the shell to
// compare both. The locators are the kept test hooks and roles only, so one
// spec fits both. The screenshots show a deployment's data and stay on the
// machine that ran the test: they go to PULP_UI_SHELL_OUT (shell-report/ unless
// set), which is ignored by git. A file is STATE.THEME.VIEWPORT.png.

const outDir = resolve(process.env['PULP_UI_SHELL_OUT'] ?? 'shell-report');

// A user name and a repository name no deployment holds.
const NO_SUCH_USER = 'zz-e2e-no-such-user';
const NO_SUCH_PASSWORD = 'zz-e2e-no-such-password';
const NO_SUCH_REPOSITORY = 'zz-e2e-no-such-repository';

async function capture(page: Page, state: string): Promise<void> {
  const { theme, viewport } = test.info().project.metadata as {
    theme: string;
    viewport: string;
  };
  mkdirSync(outDir, { recursive: true });
  // Menus, the drawer and the panels slide or fade in; finite transitions are
  // taken to their end state so no screenshot shows one half way.
  await page.screenshot({
    path: join(outDir, `${state}.${theme}.${viewport}.png`),
    animations: 'disabled',
  });
}

// ---- fixtures served by page.route ------------------------------------------

interface IFixtureTask {
  pulp_href: string;
  name: string;
  state: 'failed' | 'completed' | 'canceled';
  finished_at: string;
}

interface IFixtureRepository {
  pulp_href: string;
  name: string;
}

const ENDED_STATES = ['failed', 'completed', 'canceled'] as const;

// Every plugin the sidebar and the palette know a repository screen for.
const FIXTURE_PLUGINS = ['file', 'deb', 'rpm', 'python', 'ansible'];

// The type of repository each plugin's list holds, as it appears in the
// address of a repository.
const REPOSITORY_TYPES: Record<string, string> = {
  file: 'file',
  deb: 'apt',
  rpm: 'rpm',
  python: 'python',
  ansible: 'ansible',
};

const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function fixtureId(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, '0')}-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function fixtureTask(
  index: number,
  state: IFixtureTask['state'],
  minutes: number,
): IFixtureTask {
  return {
    pulp_href: `/pulp/api/v3/tasks/${fixtureId(1, index)}/`,
    name: `example.tasks.job-${index}`,
    state,
    finished_at: minutesAgo(minutes),
  };
}

function fixtureRepository(plugin: string, index: number): IFixtureRepository {
  const type = REPOSITORY_TYPES[plugin] ?? plugin;
  return {
    pulp_href: `/pulp/api/v3/repositories/${plugin}/${type}/${fixtureId(2, index)}/`,
    name: `example-${plugin}-${index}`,
  };
}

const listOf = <T>(results: T[]) => ({
  count: results.length,
  next: null,
  previous: null,
  results,
});

interface IFixtures {
  // Number of running tasks and of tasks that failed in the last day.
  running?: number;
  failed?: number;
  // The tasks that ended in the last week, newest first.
  ended?: IFixtureTask[];
  // The repositories the generic search answers with.
  repositories?: IFixtureRepository[];
  // The browser's remembered "seen" time for notifications.
  seenMinutesAgo?: number;
  // Report these plugins as installed, so the sidebar and the palette do not
  // depend on the deployment.
  plugins?: string[];
}

// Answers the read requests the shell sends for counts, notifications, search
// and the plugin list from the fixtures, and lets every other request through.
async function serveFixtures(page: Page, fixtures: IFixtures): Promise<void> {
  const params = (route: Route) => new URL(route.request().url()).searchParams;
  const isRead = (route: Route) => route.request().method() === 'GET';

  await page.route(
    (url) => url.pathname.endsWith('/api/v3/tasks/'),
    async (route) => {
      if (!isRead(route)) {
        return route.fallback();
      }
      const query = params(route);
      if (query.get('state') === 'running') {
        return route.fulfill({
          json: { ...listOf([]), count: fixtures.running ?? 0 },
        });
      }
      if (query.get('state') === 'failed') {
        return route.fulfill({
          json: { ...listOf([]), count: fixtures.failed ?? 0 },
        });
      }
      if (query.has('state__in') && fixtures.ended) {
        return route.fulfill({ json: listOf(fixtures.ended) });
      }
      return route.fallback();
    },
  );

  if (fixtures.repositories) {
    await page.route(
      (url) => url.pathname.endsWith('/api/v3/repositories/'),
      async (route) => {
        if (!isRead(route) || !params(route).has('name__icontains')) {
          return route.fallback();
        }
        return route.fulfill({ json: listOf(fixtures.repositories ?? []) });
      },
    );
  }

  if (fixtures.plugins) {
    const versions = ['core', ...fixtures.plugins].map((component) => ({
      component,
      version: '3.0.0',
    }));
    await page.route(
      (url) => url.pathname.endsWith('/api/v3/status/'),
      async (route) =>
        isRead(route)
          ? route.fulfill({ json: { versions } })
          : route.fallback(),
    );
  }

  if (fixtures.seenMinutesAgo !== undefined) {
    await page.addInitScript(
      ({ key, value }) => window.localStorage.setItem(key, value),
      {
        key: 'pulp-notifications-seen',
        value: minutesAgo(fixtures.seenMinutesAgo),
      },
    );
  }
}

// A page with no data of its own, so the states of the shell are shown beside
// something stable.
const QUIET_PAGE = 'about';

// Opens the palette from the keyboard, which works at every width.
async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search or go to' });
  await expect(dialog).toBeVisible();
  return dialog;
}

// Whether the element, or something inside it, scrolls on its own: its
// content is taller than its box and it has an overflow that lets it scroll.
async function scrollsInside(area: Locator): Promise<boolean> {
  return area.evaluate((root) =>
    [root, ...Array.from(root.querySelectorAll('*'))].some((element) => {
      const { overflowY } = getComputedStyle(element);
      return (
        (overflowY === 'auto' || overflowY === 'scroll') &&
        element.scrollHeight > element.clientHeight + 1
      );
    }),
  );
}

// The page itself does not scroll, whatever happens inside the overlay.
async function pageDoesNotScroll(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollHeight <= root.clientHeight + 1 && window.scrollY === 0;
  });
}

async function openMenu(page: Page, hook: string): Promise<void> {
  await page.locator(`[data-cy=${hook}]`).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function closeWithEscape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
}

test.describe('shell states', () => {
  test('account-menu', async ({ page }) => {
    await page.goto('status');
    await openMenu(page, 'user-dropdown');
    await capture(page, 'account-menu');
    await closeWithEscape(page);
  });

  test('theme-menu', async ({ page }) => {
    await page.goto('status');
    await openMenu(page, 'darkmode-dropdown');
    await capture(page, 'theme-menu');
    await closeWithEscape(page);
  });

  test('help-menu', async ({ page }) => {
    await page.goto('status');
    await openMenu(page, 'docs-dropdown');
    await capture(page, 'help-menu');
    await closeWithEscape(page);
  });

  test('about-dialog', async ({ page }) => {
    await page.goto('status');
    await openMenu(page, 'docs-dropdown');
    await page
      .getByRole('menuitem', { name: /^About(?!\s+project)/i })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, 'about-dialog');
    await closeWithEscape(page);
  });

  test('delete-confirmation @phone', async ({ page }) => {
    await page.goto('deb/repositories');
    const kebab = page.locator('[data-cy=kebab-toggle] button').first();
    await expect(kebab).toBeVisible();
    await kebab.click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Checked for, never pressed.
    await expect(
      dialog.getByRole('button', { name: /^(Delete|Remove)$/ }),
    ).toBeVisible();
    await capture(page, 'delete-confirmation');
    await closeWithEscape(page);
  });

  test('sidebar-pills', async ({ page }) => {
    await serveFixtures(page, {
      running: 3,
      failed: 2,
      plugins: FIXTURE_PLUGINS,
    });
    await page.goto(QUIET_PAGE);

    const main = page.getByRole('navigation', { name: 'Main' });
    const repositories = main.getByRole('button', { name: 'Repositories' });
    if ((await repositories.getAttribute('aria-expanded')) === 'false') {
      await repositories.click();
    }
    await expect(repositories).toHaveAttribute('aria-expanded', 'true');
    await expect(
      main.getByRole('link', {
        name: 'Tasks, 3 running tasks, 2 failed tasks in the last 24 hours',
      }),
    ).toBeVisible();
    await capture(page, 'sidebar-pills');
  });

  test('sidebar-collapsed', async ({ page }) => {
    await page.goto('status');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();

    await expect(
      page.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();
    await capture(page, 'sidebar-collapsed');
  });

  test('palette-results', async ({ page }) => {
    await serveFixtures(page, {
      plugins: FIXTURE_PLUGINS,
      repositories: [
        fixtureRepository('deb', 1),
        fixtureRepository('deb', 2),
        fixtureRepository('rpm', 1),
      ],
    });
    await page.goto(QUIET_PAGE);

    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('example');

    await expect(
      dialog.getByRole('option', { name: /example-deb-1/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('option', { name: /example-rpm-1/ }),
    ).toBeVisible();
    await expect(dialog.getByText('RPM').first()).toBeVisible();
    await capture(page, 'palette-results');
    await closeWithEscape(page);
  });

  test('palette-no-match @phone', async ({ page }) => {
    await serveFixtures(page, { plugins: FIXTURE_PLUGINS, repositories: [] });
    await page.goto(QUIET_PAGE);

    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill(NO_SUCH_REPOSITORY);

    await expect(
      dialog.getByText('No screens or repositories match'),
    ).toBeVisible();
    await capture(page, 'palette-no-match');
    await closeWithEscape(page);
  });

  test('notifications-open @phone', async ({ page }) => {
    // Three tasks ended after the remembered time and two before it.
    await serveFixtures(page, {
      seenMinutesAgo: 60,
      ended: [
        fixtureTask(1, 'failed', 5),
        fixtureTask(2, 'completed', 12),
        fixtureTask(3, 'canceled', 30),
        fixtureTask(4, 'completed', 3 * 60),
        fixtureTask(5, 'failed', 26 * 60),
      ],
    });
    await page.goto(QUIET_PAGE);

    const bell = page.getByRole('button', {
      name: 'Notifications, 3 unread notifications',
    });
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.locator('.pulp-notifications');
    await expect(panel.getByRole('listitem')).toHaveCount(5);
    await expect(
      panel.getByRole('link', { name: 'View all tasks' }),
    ).toBeVisible();
    await capture(page, 'notifications-open');
    await closeWithEscape(page);
  });

  test('populated-lists', async ({ page }) => {
    // 20 notifications, and 25 palette results: five for each of five plugins.
    const ended = Array.from({ length: 20 }, (_, index) =>
      fixtureTask(
        index + 1,
        ENDED_STATES[index % ENDED_STATES.length] ?? 'failed',
        10 + index * 90,
      ),
    );
    const repositories = FIXTURE_PLUGINS.flatMap((plugin, pluginIndex) =>
      Array.from({ length: 5 }, (_, index) =>
        fixtureRepository(plugin, pluginIndex * 5 + index + 1),
      ),
    );
    await serveFixtures(page, {
      seenMinutesAgo: 8 * 60,
      ended,
      repositories,
      plugins: FIXTURE_PLUGINS,
    });
    await page.goto(QUIET_PAGE);

    await page.getByRole('button', { name: /^Notifications/ }).click();
    const panel = page.locator('.pulp-notifications');
    await expect(panel.getByRole('listitem')).toHaveCount(20);
    expect(await scrollsInside(panel)).toBe(true);
    expect(await pageDoesNotScroll(page)).toBe(true);
    await capture(page, 'populated-lists-notifications');
    await closeWithEscape(page);
    await expect(panel.getByRole('listitem')).toHaveCount(0);

    const dialog = await openPalette(page);
    await dialog.getByRole('combobox').fill('example');
    await expect(
      dialog.getByRole('option', { name: /example-ansible-25/ }),
    ).toBeAttached();
    expect(await scrollsInside(dialog)).toBe(true);
    expect(await pageDoesNotScroll(page)).toBe(true);
    await capture(page, 'populated-lists-palette');
    await closeWithEscape(page);
  });

  test('theme switch keeps the layout', async ({ page }) => {
    // Layout is the same in both themes: only palette values change. No
    // screenshot; boxes of the shell's landmarks are compared instead.
    await page.goto('status');
    await page.waitForLoadState('networkidle');

    const landmarks = {
      banner: page.getByRole('banner'),
      navigation: page.getByRole('navigation', { name: 'Main' }),
      main: page.getByRole('main'),
      breadcrumb: page.getByRole('navigation', { name: 'Breadcrumb' }),
      tasks: page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: /^Tasks/ }),
    };
    const boxes = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(landmarks).map(
            async ([name, locator]) =>
              [name, await locator.boundingBox()] as const,
          ),
        ),
      );
    const background = () =>
      landmarks.banner.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
    const choose = async (name: 'Light' | 'Dark') => {
      await openMenu(page, 'darkmode-dropdown');
      await page.getByRole('menuitem', { name }).click();
      await expect(page.locator('html')).toHaveClass(
        name === 'Dark' ? /pf-v6-theme-dark/ : /^(?!.*pf-v6-theme-dark)/,
      );
    };

    await choose('Light');
    const light = await boxes();
    const lightBackground = await background();
    await choose('Dark');
    const dark = await boxes();
    const darkBackground = await background();

    for (const name of Object.keys(landmarks)) {
      const before = light[name];
      const after = dark[name];
      expect(before, `${name} is on the page in light`).not.toBeNull();
      expect(after, `${name} is on the page in dark`).not.toBeNull();
      if (before && after) {
        for (const edge of ['x', 'y', 'width', 'height'] as const) {
          expect(
            Math.abs(before[edge] - after[edge]),
            `${name} ${edge} differs between themes`,
          ).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(darkBackground).not.toBe(lightBackground);
  });

  test('drawer-open @phone-only', async ({ page }) => {
    await page.goto('status');

    await page.getByRole('button', { name: 'Open navigation' }).click();

    const main = page.getByRole('navigation', { name: 'Main' });
    await expect(main).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Search or go to/ }),
    ).toBeVisible();
    // The drawer fades in; the screenshot waits until it is fully shown.
    await expect(page.locator('#page-sidebar')).toHaveCSS('opacity', '1');
    await capture(page, 'drawer-open');
    await closeWithEscape(page);
    await expect(
      page.getByRole('button', { name: 'Open navigation' }),
    ).toBeFocused();
  });

  test('no horizontal page scroll at phone width @phone-only', async ({
    page,
  }) => {
    // Pages with a table and with a form-like layout, at the narrowest phone
    // widths in use.
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const path of ['status', 'deb/repositories', 'tasks']) {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        const { scroll, client } = await page.evaluate(() => ({
          scroll: document.documentElement.scrollWidth,
          client: document.documentElement.clientWidth,
        }));
        expect(
          scroll,
          `${path} scrolls sideways at ${width}px wide`,
        ).toBeLessThanOrEqual(client);
      }
    }
  });

  test('bell and search reachable at phone width @phone-only', async ({
    page,
  }) => {
    await page.goto('status');

    // The bell stays in the top bar, a touch target high.
    const bell = page.getByRole('button', { name: /^Notifications/ });
    await expect(bell).toBeVisible();
    const box = await bell.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    const viewport = page.viewportSize();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      viewport?.width ?? 0,
    );

    // The search is the first thing in the drawer.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const search = page.getByRole('button', { name: /Search or go to/ });
    await expect(search).toBeVisible();
    expect(
      await search.evaluate(
        (element) => element.parentElement?.firstElementChild === element,
      ),
    ).toBe(true);
  });

  test.describe('signed out', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('sign-in-error @phone', async ({ page }) => {
      await page.goto('login');
      await submitLoginForm(page, NO_SUCH_USER, NO_SUCH_PASSWORD);
      await expect(page.getByText(/invalid/i).first()).toBeVisible();
      await capture(page, 'sign-in-error');
    });
  });

  test('repository-list-empty @phone', async ({ page }) => {
    await page.goto(`deb/repositories?name__icontains=${NO_SUCH_REPOSITORY}`);
    await expect(page.getByText('No results found')).toBeVisible();
    await capture(page, 'repository-list-empty');
  });
});
