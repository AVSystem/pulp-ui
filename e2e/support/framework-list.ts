import { type Locator, type Page, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { apiGet } from './sdk-request';

// Helpers for the specs of the framework lists. A list marks its table with
// the state of what it reads: `data-rows-loaded` is true once the rows of the
// current address are shown (not the ones of the previous address, which stay
// on screen while the new ones are read) and `data-columns-loaded` is true once
// every column that comes from a read of its own has settled.

export type ListKind = 'Repositories' | 'Remotes';

const tableSelector = (kind: ListKind, attributes: string): string =>
  `table[aria-label="${kind}"]${attributes}`;

// The table of a list; with `rows` only once its rows are those of the
// address, with `columns` only once every derived column has settled.
export function listTable(
  page: Page,
  kind: ListKind,
  settled: { rows?: boolean; columns?: boolean } = {},
): Locator {
  const attributes = [
    settled.rows ? '[data-rows-loaded="true"]' : '',
    settled.columns ? '[data-columns-loaded="true"]' : '',
  ].join('');
  return page.locator(tableSelector(kind, attributes));
}

// The name of each row shown, top to bottom: the first link of the row.
export function shownNames(page: Page, kind: ListKind): Promise<string[]> {
  return page
    .locator(`${tableSelector(kind, '')} tbody tr`)
    .evaluateAll((rows) =>
      rows.map((row) => row.querySelector('td a')?.textContent ?? ''),
    );
}

// What the server answers for the same query as a list asks: the names of the
// first page in the order of the list and the number of matches.
export async function expectedRepositories(
  api: APIRequestContext,
  params: Record<string, string>,
  limit = 50,
): Promise<{ count: number; names: string[] }> {
  const answer = await apiGet<{ count: number; results: { name: string }[] }>(
    api,
    getRepositoriesFileFileListUrl(),
    { ...params, ordering: 'name', limit: String(limit), fields: 'name' },
  );
  return { count: answer.count, names: answer.results.map(({ name }) => name) };
}

// Waits until the list shows exactly what the server answers, in that order,
// and the toolbar says how many matched.
export async function expectListToShow(
  page: Page,
  expected: { count: number; names: string[] },
): Promise<void> {
  await expect(listTable(page, 'Repositories', { rows: true })).toBeVisible();
  await expect
    .poll(() => shownNames(page, 'Repositories'), {
      message: 'the rows shown, top to bottom',
    })
    .toEqual(expected.names);
  await expect(page.locator('.pf-v6-c-pagination').first()).toContainText(
    new RegExp(`of\\s+${expected.count}\\b`),
  );
}

// Opens a group of the sidebar (Repositories or Remotes) when it is closed.
export async function openSidebarGroup(
  page: Page,
  group: string,
): Promise<void> {
  const toggle = page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('button', { name: group, exact: true });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
    await toggle.click();
  }
}

// Opens a list through its entry in the sidebar, the way a person does, opening
// the group the entry sits in first when it is closed. `id` is the entry's id
// in the menu, for example `file-repositories`.
export async function clickSidebar(page: Page, id: string): Promise<void> {
  await openSidebarGroup(
    page,
    id.endsWith('-remotes') ? 'Remotes' : 'Repositories',
  );
  await page.locator(`[data-cy=pulp-menu-item-${id}]`).click();
}
