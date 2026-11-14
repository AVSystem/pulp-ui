import { type Page, expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { submitLoginForm } from '../support/sign-in';

// Opens the shell states and overlays that need a click (menus, dialogs, the
// sign-in error line, an empty list), screenshots each, and closes it again.
// Nothing here changes the server: a delete confirmation is only opened, its
// danger button is checked for and never pressed, no form is saved, and the one
// submit is a sign-in with a user name and password that cannot exist.
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
  await page.screenshot({
    path: join(outDir, `${state}.${theme}.${viewport}.png`),
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
