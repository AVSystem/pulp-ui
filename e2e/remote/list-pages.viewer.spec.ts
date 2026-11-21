import { type Page, expect, test } from '@playwright/test';
import { PLUGIN_MANIFESTS } from '../../src/framework/manifest';
import { title } from '../support/sign-in';
import {
  type ListPage,
  absentOptionalPlugin,
  expectNothingLoaded,
  expectPageShown,
  failureShown,
  listPages,
  missingPlugin,
  watchPage,
} from './list-pages';

// The same pages as the limited account sees them. A page its roles allow
// shows the title with no alert and no error state, and none of the controls
// that change something: no header action button, no actions menu on a row and
// no trailing actions cell, and no button or menu item in the page content
// that is not on a reviewed list of read-only controls. A page they do not allow is refused by the server
// with 403; it may show the title, or say so with an error, but an error of any
// other kind (404, 500, no answer) is a fault of the page. A screen the account
// may not open at all is replaced by the insufficient permissions page, and the
// application does not ask the server for that screen's data. None may ever meet
// the error boundary or an uncaught error. A placeholder, a not-found page and a
// not-installed page are shown to this account exactly as to the admin.

// The content region of every screen: the main container the shell renders,
// page header included.
const MAIN_CONTENT = '#main-content';

// Controls inside these parts of a page are read-only by what they are:
// column headers (sorting), the pagination, the filter toolbar group, tabs and
// the toggle that opens a row.
const READ_ONLY_PARTS = [
  'thead',
  '.pf-v6-c-pagination',
  '[data-cy=compound_filter]',
  '.pf-v6-c-tabs',
  '.pf-v6-c-table__toggle',
].join(', ');

// The accessible names of buttons and menu items outside those parts that a
// limited account may meet on a page, each one a control that cannot change
// data when pressed. A name is admitted only after checking what pressing it
// does; every other name on a page content fails the test, whatever it says.
const READ_ONLY_CONTROLS: string[] = [
  // removes the applied filters from the address; reads again, writes nothing
  'Clear all filters',
  // asks the server for the list again after a failed read
  'Retry',
  // goes to the previous screen
  'Go back',
  // expands the card that shows the status answer as text
  'JSON',
];

// Every visible button and menu item of the page content that is not read-only
// by where it sits, by accessible name. A control with no name is reported as
// its tag so it cannot slip through.
async function controlNames(page: Page): Promise<string[]> {
  return page.locator(MAIN_CONTENT).evaluate((main, parts) => {
    const nameOf = (element: Element): string => {
      const label = element.getAttribute('aria-label');
      if (label) {
        return label.trim();
      }
      const ids = element.getAttribute('aria-labelledby');
      if (ids) {
        const text = ids
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim();
        if (text) {
          return text;
        }
      }
      return (element.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    const visible = (element: Element) =>
      element.getClientRects().length > 0 &&
      !element.closest('[aria-hidden=true], [hidden]');
    return Array.from(
      main.querySelectorAll(
        'button, [role=button], [role=menuitem], summary, input[type=button], input[type=submit]',
      ),
    )
      .filter((element) => visible(element) && !element.closest(parts))
      .map(
        (element) => nameOf(element) || `<${element.tagName.toLowerCase()}>`,
      );
  }, READ_ONLY_PARTS);
}

// Fails with the offending names when the page content holds a control that is
// not read-only.
async function expectOnlyReadOnlyControls(page: Page): Promise<void> {
  const offending = (await controlNames(page)).filter(
    (name) => !READ_ONLY_CONTROLS.includes(name),
  );
  expect(
    offending,
    'buttons or menu items of the page that are not on the read-only list',
  ).toEqual([]);
}

// What a row of a list draws for an action: the actions menu, and the
// right-aligned cell that holds it.
async function expectNoRowActions(page: Page): Promise<void> {
  await expect(page.locator('[data-cy=kebab-toggle]')).toHaveCount(0);
  await expect(
    page.locator('tbody td[style*="justify-content: flex-end"]'),
  ).toHaveCount(0);
}

// Resolves once the application has read the account's own roles, so that a
// control missing from a page is missing because of what the account holds and
// not because the read was still running.
function permissionsRead(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' &&
      /\/pulp\/api\/v3\/users\/[^/]+\/roles\/$/.test(
        new URL(response.url()).pathname,
      ),
  );
}

// A list on the framework reads the catalogue of roles to learn what the roles
// the account holds on single objects allow. A server that keeps the roles from
// an account that is not an administrator answers 403, and the list then reads
// what each role allows from the account's own assignments. That refusal is the
// expected answer, not a failure of the page.
const onFramework = (entry: ListPage) =>
  PLUGIN_MANIFESTS.some(
    ({ plugin, onFramework: served }) =>
      served && entry.path.startsWith(`${plugin}/`),
  );

const expectedRefusal = ({ url, status }: { url: string; status: number }) =>
  status === 403 && url === '/pulp/api/v3/roles/';

for (const entry of listPages) {
  const how = entry.viewerNoScreen
    ? 'shows the insufficient permissions page'
    : entry.viewerRefused
      ? 'is refused with 403 or shows its title'
      : 'shows its title without an error or a control that changes data';
  test(`${entry.name} (${entry.path}) ${how}`, async ({ page }) => {
    const absent = await missingPlugin(entry);
    test.skip(absent !== null, absent ?? '');
    test.fail(!!entry.knownDefect?.viewer, entry.knownDefect?.viewer ?? '');

    const notInstalled = await absentOptionalPlugin(entry);
    const watch = watchPage(page);
    const rolesRead = permissionsRead(page);

    await page.goto(entry.path);
    if (entry.viewerNoScreen) {
      await expect(title(page, 'Insufficient permissions')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
    } else if (entry.viewerRefused) {
      await expect(
        title(page, entry.title).or(failureShown(page)).first(),
      ).toBeVisible();
    } else {
      await expectPageShown(page, entry, notInstalled);
    }
    await rolesRead;
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    expect(watch.errors, 'uncaught errors of the page').toEqual([]);

    if (entry.viewerNoScreen) {
      expect(watch.failed, 'API requests of the page that failed').toEqual([]);
      expect(
        watch.requests.filter(
          (path) => path === `/pulp/api/v3/${entry.dataPath ?? entry.path}/`,
        ),
        'requests of the page for the data of the screen it did not show',
      ).toEqual([]);
      return;
    }

    if (!entry.viewerRefused) {
      await expect(failureShown(page)).toHaveCount(0);
      expect(
        watch.failed.filter(
          (failed) => !(onFramework(entry) && expectedRefusal(failed)),
        ),
        'API requests of the page that failed',
      ).toEqual([]);
      expectNothingLoaded(watch, entry, notInstalled);
      await expectOnlyReadOnlyControls(page);
      await expectNoRowActions(page);
      return;
    }

    if ((await failureShown(page).count()) > 0) {
      expect(
        watch.failed.length,
        'the page shows an error, so a request failed',
      ).toBeGreaterThan(0);
    }
    expect(
      watch.failed.filter(({ status }) => status !== 403),
      'failed API requests of the page that are not 403',
    ).toEqual([]);
  });
}
