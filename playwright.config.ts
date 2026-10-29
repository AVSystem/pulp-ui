import { defineConfig } from '@playwright/test';
import { SCREEN_SIZES, crawlAccount } from './e2e/crawl/report';
import { storageStatePath } from './e2e/support/accounts';

// The target and the account come from the environment only (see
// e2e/support/env.ts); nothing here names a host or a credential. The base URL
// is the UI root and must end in /ui/, and tests navigate with relative paths
// such as page.goto('deb/repositories') so the prefix is kept.
//
// The remote projects run against a deployment given by PULP_UI_E2E_BASE_URL
// with the accounts listed in the JSON file named by PULP_UI_E2E_ACCOUNTS. They
// sign in once through the API (remote-setup), reuse that session per role, and
// end it again (remote-teardown). They are meant for a person at a terminal, not
// for a hosted workflow: their output holds session data.
// The screen crawler (e2e/crawl) visits every route of the application, signed
// in as the account named by PULP_UI_CRAWL_ACCOUNT (admin unless set to
// viewer), and writes its report to PULP_UI_CRAWL_OUT (crawl-report/ unless
// set). One project is one theme at one width; the theme is the browser's
// colour scheme, which the application follows when the user has made no
// choice. Reports show a deployment's data and URLs and are meant to stay on
// the machine that ran the crawl.
function crawlProject(theme: 'light' | 'dark', viewport: 'desktop' | 'phone') {
  return {
    name: `crawl-${theme}-${viewport}`,
    testMatch: 'crawl/**/*.spec.ts',
    metadata: { theme, viewport },
    use: {
      colorScheme: theme,
      viewport: SCREEN_SIZES[viewport],
      ...(viewport === 'phone' ? { isMobile: true, hasTouch: true } : {}),
      storageState: storageStatePath(crawlAccount()),
    },
    dependencies: ['remote-setup'],
  };
}

export default defineConfig({
  testDir: 'e2e',
  // The crawl run is named before the workers start and summarised after every
  // project has finished; both do nothing in a run without crawl projects.
  globalSetup: './e2e/crawl/global-setup.ts',
  globalTeardown: './e2e/crawl/summarize.ts',
  // One worker in CI: the tests share one Pulp and sign in as the same account.
  workers: process.env['CI'] ? 1 : undefined,
  forbidOnly: !!process.env['CI'],
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env['PULP_UI_E2E_BASE_URL'],
    // Failure evidence is kept, successful runs leave nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1920, height: 1080 },
  },
  projects: [
    {
      name: 'smoke',
      testMatch: 'smoke/**/*.spec.ts',
    },
    {
      name: 'remote-setup',
      testMatch: 'remote/auth.setup.ts',
      teardown: 'remote-teardown',
    },
    {
      name: 'remote-teardown',
      testMatch: 'remote/auth.teardown.ts',
    },
    {
      name: 'remote-admin',
      testMatch: 'remote/**/*.spec.ts',
      testIgnore: '**/*.viewer.spec.ts',
      use: { storageState: 'playwright/.auth/admin.json' },
      dependencies: ['remote-setup'],
    },
    {
      name: 'remote-viewer',
      testMatch: 'remote/**/*.viewer.spec.ts',
      use: { storageState: 'playwright/.auth/viewer.json' },
      dependencies: ['remote-setup'],
    },
    crawlProject('light', 'desktop'),
    crawlProject('dark', 'desktop'),
    crawlProject('light', 'phone'),
    crawlProject('dark', 'phone'),
  ],
});
