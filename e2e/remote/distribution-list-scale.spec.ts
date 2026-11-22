import { type Page, expect, test } from '@playwright/test';
import { apiContext, listAll } from '../support/api';
import { baseUrl } from '../support/env';
import { clickSidebar, listTable } from '../support/framework-list';
import { title } from '../support/sign-in';

// How fast the list of every plugin's distributions responds on a server that
// holds 1,300 and more distributions (the lab's seeded data, which this spec
// only reads). Time runs from the click or the move that asks for the screen,
// with the application already loaded and the screen's data not in its cache,
// to the table attribute that says the rows (`data-rows-loaded`) or every
// column that has a read of its own (`data-columns-loaded`) is there. Every
// figure is the median of five runs, and no single run may take more than
// twice its budget. The figures are printed, attached to the report and
// asserted; they are kept in the report folder and never committed.

const RUNS = 5;
const LIMIT_FACTOR = 2;

// Budgets in milliseconds.
const BUDGET = {
  pageRows: 2_000,
  pageColumns: 3_000,
  largeRows: 4_000,
  largeColumns: 8_000,
  publicOnly: 4_000,
  basePath: 3_000,
} as const;

// The most API requests one load of the list may make.
const REQUESTS = { page: 16, large: 48 } as const;

// An address of one object, not of a list: a uuid or a number is its last
// segment. A list must read objects in batches and never one by one.
const SINGLE_OBJECT =
  /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|\d+)\/$/i;

interface Figure {
  name: string;
  runs: number[];
  budget: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
};

const figures: Figure[] = [];

// Prints the figure and keeps it for the report, then asserts the median and
// the slowest run against the budget without ending the test, so every figure
// of a test is taken.
function judge(name: string, runs: number[], budget: number): void {
  figures.push({ name, runs, budget });
  const slowest = Math.max(...runs);
  console.log(
    `SCALE ${name}: median ${Math.round(median(runs))} ms, maximum ${Math.round(slowest)} ms, budget ${budget} ms, runs [${runs
      .map((run) => Math.round(run))
      .join(', ')}]`,
  );
  expect
    .soft(median(runs), `${name}: median of ${RUNS} runs`)
    .toBeLessThanOrEqual(budget);
  expect
    .soft(slowest, `${name}: slowest of ${RUNS} runs`)
    .toBeLessThanOrEqual(budget * LIMIT_FACTOR);
}

test.afterAll(async () => {
  await test.info().attach('scale-figures.json', {
    body: JSON.stringify(figures, null, 2),
    contentType: 'application/json',
  });
});

const elapsed = (since: number) => performance.now() - since;

// A fresh load of the application on its Status screen, so no list has been
// read.
async function fresh(page: Page): Promise<void> {
  await page.goto('status');
  await expect(title(page, 'Status')).toBeVisible();
  await page.waitForLoadState('networkidle');
}

// Moves inside the application to an address, as following a link does: the
// page is not loaded again, so what the application has read stays in its
// cache. The address is below the UI root of the run, which the page must be
// under; a page anywhere else is a mistake of the test and fails here, not as
// a missing table later.
async function moveTo(page: Page, address: string): Promise<void> {
  const root = new URL(baseUrl()).pathname;
  const here = new URL(page.url()).pathname;
  if (!here.startsWith(root)) {
    throw new Error(`the page is at ${here}, not under the UI root ${root}`);
  }

  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, `${root}${address}`);
}

// Times how long the list takes to show its rows and then to settle every
// column that reads for itself, from the moment `trigger` is called. Both
// waits are started before the trigger and both are always handled: a trigger
// that fails must not leave a wait behind that rejects unhandled later, when
// its timeout runs out, and is reported as a second, misleading failure.
async function timeLoad(
  page: Page,
  trigger: () => Promise<unknown>,
): Promise<{ rows: number; columns: number }> {
  const start = performance.now();
  const timeUntil = (settled: { rows?: boolean; columns?: boolean }) =>
    listTable(page, 'Distributions', settled)
      .waitFor()
      .then(() => elapsed(start));
  const waits = Promise.allSettled([
    timeUntil({ rows: true }),
    timeUntil({ rows: true, columns: true }),
  ]);

  await trigger();
  const [rows, columns] = await waits;
  if (rows.status === 'rejected') {
    throw rows.reason;
  }
  if (columns.status === 'rejected') {
    throw columns.reason;
  }
  return { rows: rows.value, columns: columns.value };
}

const requestsOf = (page: Page) => {
  const seen: string[] = [];
  const listener = (request: { url: () => string }) => {
    const { pathname, search } = new URL(request.url());
    if (pathname.startsWith('/pulp/api/')) {
      seen.push(`${pathname}${search}`);
    }
  };
  page.on('request', listener);
  return {
    seen,
    stop: () => page.off('request', listener),
  };
};

function expectOnlyListReads(reads: string[], name: string): void {
  const offending = reads.filter(
    (read) =>
      read.includes('my_permissions') ||
      SINGLE_OBJECT.test(read.split('?')[0] ?? ''),
  );
  expect(
    offending,
    `${name}: requests to one object's address or to my_permissions`,
  ).toEqual([]);
}

const settle = (page: Page) => page.waitForTimeout(500);

// The types the list asks for: the distributions of the installed plugins.
const LISTED_TYPES = [
  'file.file',
  'deb.apt-distribution',
  'rpm.rpm',
  'python.python',
  'maven.maven',
  'npm.npm',
  'ansible.ansible',
  'container.container',
].join(',');

// How many distributions the list holds that have no content guard, from the
// server, taken before the clock runs: the public-only result has arrived when
// the list says that many matched. The table of the unfiltered list stays on
// screen for a moment after the switch is pressed, so its attributes alone do
// not tell the two apart.
async function publicDistributions(): Promise<number> {
  const api = await apiContext();
  try {
    const rows = await listAll(api, 'distributions/', {
      pulp_type__in: LISTED_TYPES,
      fields: 'pulp_href,content_guard',
    });
    return rows.filter((row) => row['content_guard'] === null).length;
  } finally {
    await api.dispose();
  }
}

// Picks which filter the search box applies; the box keeps the choice of the
// run before.
async function chooseFilter(page: Page, name: string): Promise<void> {
  await page
    .locator('[data-cy=compound_filter]')
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

test.describe('@scale the distribution list at 1300 or more distributions', () => {
  // A figure over its budget fails its test softly: the tests are independent,
  // so a miss never hides the figures of the others.
  test.setTimeout(600_000);

  test('@scale D1 the default page of 50 shows its rows, settles its columns and reads within the request budget', async ({
    page,
  }) => {
    const rows: number[] = [];
    const columns: number[] = [];
    const counts: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page);
      const requests = requestsOf(page);

      const timed = await timeLoad(page, () =>
        clickSidebar(page, 'distributions'),
      );
      rows.push(timed.rows);
      columns.push(timed.columns);
      await settle(page);
      requests.stop();

      expect(await page.locator('tbody tr').count(), 'rows of the page').toBe(
        50,
      );
      expectOnlyListReads(requests.seen, 'D1');
      counts.push(requests.seen.length);
    }

    judge('D1 rows shown (50)', rows, BUDGET.pageRows);
    judge('D1 columns settled (50)', columns, BUDGET.pageColumns);
    console.log(
      `SCALE D3 requests of one load of 50 rows: ${counts.join(', ')}`,
    );
    expect
      .soft(Math.max(...counts), 'D3 requests of a load of 50 rows')
      .toBeLessThanOrEqual(REQUESTS.page);
  });

  test('@scale D2 a page of 500 shows its rows, settles its columns and reads within the request budget', async ({
    page,
  }) => {
    const rows: number[] = [];
    const columns: number[] = [];
    const counts: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page);
      const requests = requestsOf(page);

      // the sidebar leads to the default page, so the page of 500 is reached by
      // a move inside the application; its data is not in the cache
      const timed = await timeLoad(page, () =>
        moveTo(page, 'distributions?page_size=500'),
      );
      rows.push(timed.rows);
      columns.push(timed.columns);
      await settle(page);
      requests.stop();

      expect(await page.locator('tbody tr').count(), 'rows of the page').toBe(
        500,
      );
      expectOnlyListReads(requests.seen, 'D2');
      counts.push(requests.seen.length);
    }

    judge('D2 rows shown (500)', rows, BUDGET.largeRows);
    judge('D2 columns settled (500)', columns, BUDGET.largeColumns);
    console.log(
      `SCALE D3 requests of one load of 500 rows: ${counts.join(', ')}`,
    );
    expect
      .soft(Math.max(...counts), 'D3 requests of a load of 500 rows')
      .toBeLessThanOrEqual(REQUESTS.large);
  });

  test('@scale D4 the public-only filter and a base path filter show their rows quickly', async ({
    page,
  }) => {
    const publicOnly: number[] = [];
    const byBasePath: number[] = [];

    // each run asks for a base path the list has not been asked before
    const basePaths = [
      'zz-synth-file-0011',
      'zz-synth-file-0012',
      'zz-synth-file-0013',
      'zz-synth-file-0015',
      'zz-synth-file-0016',
    ];

    const publicCount = await publicDistributions();
    expect(publicCount, 'public distributions on the server').toBeGreaterThan(
      0,
    );

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page);
      await clickSidebar(page, 'distributions');
      await expect(
        listTable(page, 'Distributions', { rows: true, columns: true }),
      ).toBeVisible();
      await settle(page);

      // public only: the result has arrived when the list says how many
      // matched and shows that many rows, all public
      let start = performance.now();
      // the switch's input sits under its drawn toggle, so the click goes to
      // the label that wraps both
      await page.locator('label[for="distribution-public-only"]').click();
      await expect(page).toHaveURL(/public=true/);
      await expect(page.locator('.pf-v6-c-pagination').first()).toContainText(
        new RegExp(`of\\s+${publicCount}\\b`),
      );
      await expect(
        listTable(page, 'Distributions', { rows: true }),
      ).toBeVisible();
      await expect(page.locator('tbody tr')).toHaveCount(
        Math.min(publicCount, 50),
      );
      await expect(page.locator('tbody tr').first()).toContainText('Public');
      publicOnly.push(elapsed(start));

      // base path
      await moveTo(page, 'distributions');
      await expect(page).not.toHaveURL(/public=|base_path/);
      await chooseFilter(page, 'Base path');
      const pathBox = page.getByRole('textbox', {
        name: 'base_path__icontains',
      });
      await pathBox.fill(basePaths[run] as string);
      start = performance.now();
      await pathBox.press('Enter');
      await expect(page).toHaveURL(/base_path__icontains=/);
      await expect(page.locator('tbody tr').first()).toContainText(
        basePaths[run] as string,
      );
      await expect(
        listTable(page, 'Distributions', { rows: true }),
      ).toBeVisible();
      byBasePath.push(elapsed(start));
    }

    judge('D4 public only applied', publicOnly, BUDGET.publicOnly);
    judge('D4 base path filter applied', byBasePath, BUDGET.basePath);
  });
});
