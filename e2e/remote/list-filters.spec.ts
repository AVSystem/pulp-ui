import {
  type APIRequestContext,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { getDistributionsFileFileListUrl } from '@pulp-ui/sdk/file/distributions-file';
import { apiContext, listAll } from '../support/api';
import {
  expectListToShow,
  expectedRepositories,
  listTable,
} from '../support/framework-list';
import { apiGet } from '../support/sdk-request';
import { title } from '../support/sign-in';

// The filters of the file repository list against the server's own answer for
// the same question: the rows shown are the first page of what the server
// returns for the filter, in the same order, and the toolbar counts the same
// matches. The lab's seeded installations (`zz-synth-file-NNNN`) are only
// read, never written.

let api: APIRequestContext;

test.beforeAll(async () => {
  api = await apiContext();
});

test.afterAll(async () => {
  await api.dispose();
});

// Opens the list with nothing filtered and waits for its rows.
async function openList(page: Page): Promise<void> {
  await page.goto('file/repositories');
  await expect(title(page, 'Repositories')).toBeVisible();
  await expect(
    listTable(page, 'Repositories', { rows: true, columns: true }),
  ).toBeVisible();
}

const labelPopover = (page: Page) => page.locator('.pf-v6-c-popover');

async function openLabelFilter(page: Page) {
  await page.getByRole('button', { name: /^Labels/ }).click();
  const popover = labelPopover(page);
  await expect(popover).toBeVisible();
  return popover;
}

test('the name filter shows the repositories whose name contains the text, as the server lists them', async ({
  page,
}) => {
  // ten seeded repositories carry this text in their name
  const text = 'zz-synth-file-001';
  const expected = await expectedRepositories(api, { name__icontains: text });
  expect(expected.count, 'repositories matching the name').toBeGreaterThan(1);

  await openList(page);
  const box = page.getByRole('textbox', { name: 'name__icontains' });
  await box.fill(text);
  await box.press('Enter');

  await expect(page).toHaveURL(new RegExp(`name__icontains=${text}`));
  await expectListToShow(page, expected);
});

test('two label conditions show the repositories that hold both labels, as the server lists them', async ({
  page,
}) => {
  const expected = await expectedRepositories(api, {
    pulp_label_select: 'tier=alpha,scale=file-1k',
  });
  expect(expected.count, 'repositories holding both labels').toBeGreaterThan(1);

  await openList(page);
  const popover = await openLabelFilter(page);
  await popover.getByLabel('Label key', { exact: true }).first().fill('tier');
  await popover
    .getByLabel('Label value', { exact: true })
    .first()
    .fill('alpha');
  await popover.getByRole('button', { name: 'Add label condition' }).click();
  await popover.getByLabel('Label key', { exact: true }).nth(1).fill('scale');
  await popover
    .getByLabel('Label value', { exact: true })
    .nth(1)
    .fill('file-1k');
  await popover.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(page).toHaveURL(/pulp_label_select=/);
  await expectListToShow(page, expected);
});

test('an advanced expression with an escaped comma matches the labels whose value holds a comma', async ({
  page,
}) => {
  // every tenth seeded repository carries note=a,b
  const expression = String.raw`note=a\,b`;
  const expected = await expectedRepositories(api, {
    pulp_label_select: expression,
  });
  expect(
    expected.count,
    'repositories with a comma in a value',
  ).toBeGreaterThan(1);

  await openList(page);
  const popover = await openLabelFilter(page);
  await popover.getByRole('button', { name: 'Write an expression' }).click();
  await popover
    .getByRole('textbox', { name: 'Label expression' })
    .fill(expression);
  await popover.getByRole('button', { name: 'Apply', exact: true }).click();

  await expect(page).toHaveURL(/pulp_label_select=note%3Da%5C%2Cb/);
  await expectListToShow(page, expected);
});

// The repository a distribution serves: the one it is bound to, or the one the
// publication it is bound to was made from.
async function repositoryNamesServedAt(text: string): Promise<string[]> {
  const distributions = await listAll(api, getDistributionsFileFileListUrl(), {
    base_path__icontains: text,
    fields: 'base_path,repository,publication',
  });
  expect(distributions, 'distributions matching the base path').not.toEqual([]);

  const hrefs = new Set<string>();
  for (const { repository, publication } of distributions) {
    if (typeof repository === 'string') {
      hrefs.add(repository);
    } else if (typeof publication === 'string') {
      const { repository_version: version } = await apiGet<{
        repository_version: string;
      }>(api, publication);
      hrefs.add(version.replace(/versions\/\d+\/?$/, ''));
    }
  }

  const names: string[] = [];
  for (const href of hrefs) {
    const { name } = await apiGet<{ name: string }>(api, href);
    names.push(name);
  }
  return names.sort();
}

test('the base path filter shows the repositories served at a base path that contains the text', async ({
  page,
}) => {
  // one seeded repository is served at this base path alone
  const text = 'zz-synth-file-0012';
  const names = await repositoryNamesServedAt(text);
  expect(names, 'the repository served at the base path').toEqual([text]);

  await openList(page);
  await page
    .locator('[data-cy=compound_filter]')
    .getByRole('button')
    .first()
    .click();
  await page.getByRole('menuitem', { name: 'Base path' }).click();
  const box = page.getByRole('textbox', { name: 'base_path' });
  await box.fill(text);
  await box.press('Enter');

  await expect(page).toHaveURL(new RegExp(`base_path=${text}`));
  await expectListToShow(page, { count: names.length, names });
});
