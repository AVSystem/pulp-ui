import { type Page, expect, test } from '@playwright/test';
import { apiContext } from '../support/api';
import { baseUrl } from '../support/env';
import {
  type ListKind,
  clickSidebar,
  expectedRepositories,
  listTable,
  openSidebarGroup,
} from '../support/framework-list';
import { title } from '../support/sign-in';

// How fast the file lists respond on a server that holds 1,000 and more file
// repositories (the lab's seeded data, which this spec only reads). Time runs
// from the click or the move that asks for the screen, with the application
// already loaded and the screen's data not in its cache, to the table
// attribute that says the rows (`data-rows-loaded`) or every column that has a
// read of its own (`data-columns-loaded`) is there. Every figure is the median
// of five runs, and no single run may take more than twice its budget. The
// figures are printed, attached to the report and asserted; they are kept in
// the report folder and never committed.

const RUNS = 5;
const LIMIT_FACTOR = 2;

// Budgets in milliseconds.
const BUDGET = {
  pageRows: 2_000,
  pageColumns: 3_000,
  largeRows: 4_000,
  largeColumns: 8_000,
  selectAll: 1_500,
  filter: 2_000,
  basePath: 3_000,
  detail: 2_000,
  remoteColumns: 3_000,
} as const;

// The most API requests one load of the list may make.
const REQUESTS = { page: 12, large: 40 } as const;

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
// read, with the group of the sidebar the list sits in open.
async function fresh(page: Page, group: string): Promise<void> {
  await page.goto('status');
  await expect(title(page, 'Status')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await openSidebarGroup(page, group);
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

// Times how long a list takes to show its rows and then to settle every column
// that reads for itself, from the moment `trigger` is called. Both waits are
// started before the trigger and both are always handled: a trigger that fails
// must not leave a wait behind that rejects unhandled later, when its timeout
// runs out, and is reported as a second, misleading failure.
async function timeLoad(
  page: Page,
  kind: ListKind,
  trigger: () => Promise<unknown>,
): Promise<{ rows: number; columns: number }> {
  const start = performance.now();
  const timeUntil = (settled: { rows?: boolean; columns?: boolean }) =>
    listTable(page, kind, settled)
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

test.describe('@scale the file lists at 1000 or more repositories', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(300_000);

  test('@scale L1 the default page of 50 shows its rows, settles its columns and reads within the request budget', async ({
    page,
  }) => {
    const rows: number[] = [];
    const columns: number[] = [];
    const counts: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page, 'Repositories');
      const requests = requestsOf(page);
      const link = page.locator('[data-cy=pulp-menu-item-file-repositories]');

      const timed = await timeLoad(page, 'Repositories', () => link.click());
      rows.push(timed.rows);
      columns.push(timed.columns);
      await settle(page);
      requests.stop();

      expect(await page.locator('tbody tr').count(), 'rows of the page').toBe(
        50,
      );
      expectOnlyListReads(requests.seen, 'L1');
      counts.push(requests.seen.length);
    }

    judge('L1 rows shown (50)', rows, BUDGET.pageRows);
    judge('L1 columns settled (50)', columns, BUDGET.pageColumns);
    console.log(
      `SCALE L3 requests of one load of 50 rows: ${counts.join(', ')}`,
    );
    expect
      .soft(Math.max(...counts), 'L3 requests of a load of 50 rows')
      .toBeLessThanOrEqual(REQUESTS.page);
  });

  test('@scale L2 a page of 500 shows its rows, settles its columns, offers the bulk delete and reads within the request budget', async ({
    page,
  }) => {
    const rows: number[] = [];
    const columns: number[] = [];
    const select: number[] = [];
    const counts: number[] = [];

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page, 'Repositories');
      const requests = requestsOf(page);

      const timed = await timeLoad(page, 'Repositories', () =>
        moveTo(page, 'file/repositories?page_size=500'),
      );
      rows.push(timed.rows);
      columns.push(timed.columns);
      await settle(page);
      requests.stop();

      expect(await page.locator('tbody tr').count(), 'rows of the page').toBe(
        500,
      );
      expectOnlyListReads(requests.seen, 'L2');
      counts.push(requests.seen.length);

      // select the whole page and open the bulk delete confirmation; the
      // dialog is only looked at, never confirmed
      const selectAll = page.getByRole('checkbox', {
        name: 'Select all repositories on this page',
      });
      const begin = performance.now();
      await selectAll.check();
      await page.getByRole('button', { name: 'Bulk actions' }).click();
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
      const dialog = page.locator('[data-cy=BulkDialog]');
      await expect(
        dialog.getByRole('button', { name: 'Delete', exact: true }),
      ).toBeEnabled();
      select.push(elapsed(begin));
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(dialog).toHaveCount(0);
    }

    judge('L2 rows shown (500)', rows, BUDGET.largeRows);
    judge('L2 columns settled (500)', columns, BUDGET.largeColumns);
    judge(
      'L2 select all and open the bulk delete (500)',
      select,
      BUDGET.selectAll,
    );
    console.log(
      `SCALE L3 requests of one load of 500 rows: ${counts.join(', ')}`,
    );
    expect
      .soft(Math.max(...counts), 'L3 requests of a load of 500 rows')
      .toBeLessThanOrEqual(REQUESTS.large);
  });

  test('@scale L4 a name filter, a label filter and a base path filter show their rows quickly', async ({
    page,
  }) => {
    const byName: number[] = [];
    const byLabel: number[] = [];
    const byBasePath: number[] = [];

    // each run asks something the list has not been asked before
    const names = ['0001', '0002', '0003', '0004', '0005'];
    const labels = [
      'tier=alpha',
      'tier=beta',
      'tier=gamma',
      String.raw`note=a\,b`,
      'app.example-name=web',
    ];
    // seeded installations whose number is not a multiple of 7, which are the
    // ones that have a distribution
    const basePaths = [
      'zz-synth-file-0011',
      'zz-synth-file-0012',
      'zz-synth-file-0013',
      'zz-synth-file-0015',
      'zz-synth-file-0016',
    ];

    // what the server answers for each label expression, taken before the
    // clock runs
    const api = await apiContext();
    const answers = await Promise.all(
      labels.map((expression) =>
        expectedRepositories(api, { pulp_label_select: expression }),
      ),
    );
    await api.dispose();
    for (const answer of answers) {
      expect(
        answer.count,
        'repositories matching an expression',
      ).toBeGreaterThan(0);
    }

    await fresh(page, 'Repositories');
    await clickSidebar(page, 'file-repositories');
    await expect(
      listTable(page, 'Repositories', { rows: true, columns: true }),
    ).toBeVisible();
    // let the label keys and the index of distributions be read
    await settle(page);

    // The first row of a result is how a person tells that it has arrived.
    const firstRowIs = async (text: RegExp) =>
      expect(page.locator('tbody tr').first()).toContainText(text);

    for (let run = 0; run < RUNS; run += 1) {
      // name
      await moveTo(page, 'file/repositories');
      await expect(page).not.toHaveURL(
        /name__icontains|pulp_label_select|base_path/,
      );
      await chooseFilter(page, 'Repository name');
      const nameBox = page.getByRole('textbox', { name: 'name__icontains' });
      await nameBox.fill(`zz-synth-file-${names[run]}`);
      let start = performance.now();
      await nameBox.press('Enter');
      await expect(page).toHaveURL(/name__icontains=/);
      await firstRowIs(new RegExp(`zz-synth-file-${names[run]}`));
      await expect(
        listTable(page, 'Repositories', { rows: true }),
      ).toBeVisible();
      byName.push(elapsed(start));

      // labels
      await moveTo(page, 'file/repositories');
      await expect(page).not.toHaveURL(
        /name__icontains|pulp_label_select|base_path/,
      );
      await page.getByRole('button', { name: /^Labels/ }).click();
      const popover = page.locator('.pf-v6-c-popover');
      const write = popover.getByRole('button', {
        name: 'Write an expression',
      });
      if (await write.isVisible()) {
        await write.click();
      }
      await popover
        .getByRole('textbox', { name: 'Label expression' })
        .fill(labels[run] as string);
      start = performance.now();
      await popover.getByRole('button', { name: 'Apply', exact: true }).click();
      await expect(page).toHaveURL(/pulp_label_select=/);
      // the result has arrived when the list shows what the server answers for
      // the expression: its first row and the number of matches
      await expect(page.locator('tbody tr').first()).toContainText(
        answers[run]?.names[0] as string,
      );
      await expect(page.locator('.pf-v6-c-pagination').first()).toContainText(
        new RegExp(`of\\s+${answers[run]?.count}\\b`),
      );
      await expect(
        listTable(page, 'Repositories', { rows: true }),
      ).toBeVisible();
      byLabel.push(elapsed(start));
      // the panel is still closing for a moment: a key pressed while it traps
      // the focus never reaches the next filter's box
      await expect(popover).toHaveCount(0);

      // base path
      await moveTo(page, 'file/repositories');
      await expect(page).not.toHaveURL(
        /name__icontains|pulp_label_select|base_path/,
      );
      await chooseFilter(page, 'Base path');
      const pathBox = page.getByRole('textbox', { name: 'base_path' });
      await pathBox.fill(basePaths[run] as string);
      start = performance.now();
      await pathBox.press('Enter');
      await expect(page).toHaveURL(/base_path=/);
      await firstRowIs(new RegExp(basePaths[run] as string));
      await expect(
        listTable(page, 'Repositories', { rows: true }),
      ).toBeVisible();
      byBasePath.push(elapsed(start));
    }

    judge('L4 name filter applied', byName, BUDGET.filter);
    judge('L4 label filter applied', byLabel, BUDGET.filter);
    judge('L4 base path filter applied', byBasePath, BUDGET.basePath);
  });

  test('@scale L5 the repository details and the remote list with its used-by column appear quickly', async ({
    page,
  }) => {
    const detail: number[] = [];
    const remotes: number[] = [];

    await fresh(page, 'Repositories');
    await clickSidebar(page, 'file-repositories');
    await expect(
      listTable(page, 'Repositories', { rows: true, columns: true }),
    ).toBeVisible();
    await settle(page);

    for (let run = 0; run < RUNS; run += 1) {
      // a different repository each time, so its own read is not cached
      const link = page.locator('tbody tr').nth(run).locator('td a').first();
      const name = (await link.innerText()).trim();
      const start = performance.now();
      await link.click();
      await expect(
        page.locator('.pf-v6-c-description-list__group', {
          hasText: 'Repository name',
        }),
      ).toContainText(name);
      detail.push(elapsed(start));
      await expect(page.locator('.pf-v6-c-skeleton')).toHaveCount(0);
      await page.goBack();
      await expect(
        listTable(page, 'Repositories', { rows: true }),
      ).toBeVisible();
    }

    for (let run = 0; run < RUNS; run += 1) {
      await fresh(page, 'Remotes');
      const timed = await timeLoad(page, 'Remotes', () =>
        page.locator('[data-cy=pulp-menu-item-file-remotes]').click(),
      );
      remotes.push(timed.columns);
    }

    judge('L5 repository Details tab shown', detail, BUDGET.detail);
    judge(
      'L5 remote list, used-by column settled',
      remotes,
      BUDGET.remoteColumns,
    );
  });
});
