import { type Page, expect } from '@playwright/test';
import { listRow, openListFiltered } from './distribution-screens';
import { ALL_WARNINGS, type ServingState } from './serving-states';
import { title } from './sign-in';

// The checks of what the screens say about the served state of the lab's
// serving distributions, shared by the specs of the administrator and of the
// viewer. Each takes the table of states one account is shown.

const SERVING_PREFIX = 'zz-synth-serving-';

// The column of the list that holds the served state.
const SERVED_COLUMN = 6;

// The list narrowed to the serving objects shows the served state of every
// row: the cell holds exactly the text the state is drawn with.
export async function expectListStates(
  page: Page,
  states: ServingState[],
): Promise<void> {
  await openListFiltered(page, SERVING_PREFIX, '&page_size=100');
  await expect(
    page.locator(
      'table[aria-label="Distributions"][data-columns-loaded="true"]',
    ),
  ).toBeVisible();
  // the table holds exactly the distributions the account is shown
  await expect(page.locator('tbody tr')).toHaveCount(states.length);

  for (const { name, served } of states) {
    await expect(
      listRow(page, name).locator('td').nth(SERVED_COLUMN),
      `served state of ${name} on the list`,
    ).toHaveText(served);
  }
}

// The label beside the address on a page that shows the distribution's URL: the
// one of the state, and none of the others. A page that is still reading what
// the distribution serves draws no label yet, so the absence of the others is
// only checked once the page has settled.
async function expectWarning(
  page: Page,
  scope: ReturnType<Page['locator']>,
  state: ServingState,
): Promise<void> {
  if (state.warning !== null) {
    await expect(
      scope.locator('.pf-v6-c-label', { hasText: state.warning }),
      `the label of ${state.name}`,
    ).toBeVisible();
  }
  await expect(scope.locator('.pf-v6-c-skeleton')).toHaveCount(0);
  await page.waitForLoadState('networkidle');
  for (const other of ALL_WARNINGS.filter((text) => text !== state.warning)) {
    await expect(
      scope.locator('.pf-v6-c-label', { hasText: other }),
      `${other} is not drawn for ${state.name}`,
    ).toHaveCount(0);
  }
}

// The page of one distribution.
export async function expectDetailState(
  page: Page,
  state: ServingState,
): Promise<void> {
  await page.goto(
    `${state.plugin}/distributions/${encodeURIComponent(state.name)}`,
  );
  await expect(title(page, state.name)).toBeVisible();
  await expectWarning(
    page,
    page.locator('[data-cy=DistributionDetail-details]'),
    state,
  );
}

// The Distributions tab of the repository the distribution serves, which has
// the name of the distribution.
export async function expectTabState(
  page: Page,
  state: ServingState,
): Promise<void> {
  await page.goto(
    `${state.plugin}/repositories/${encodeURIComponent(state.name)}/distributions`,
  );
  await expect(title(page, state.name)).toBeVisible();
  const tab = page.locator('[data-cy=DistributionsTab]').locator('..');
  const row = tab.getByRole('row').filter({ hasText: state.name });
  await expect(row, `${state.name} on the tab of its repository`).toBeVisible();
  await expectWarning(page, row, state);
}
