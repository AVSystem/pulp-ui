import { defineConfig } from '@playwright/test';

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
export default defineConfig({
  testDir: 'e2e',
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
  ],
});
