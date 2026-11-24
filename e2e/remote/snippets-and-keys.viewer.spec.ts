import { expect, request, test } from '@playwright/test';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account } from '../support/accounts';
import { TestObjects } from '../support/api';
import { origin } from '../support/env';
import { apiGet } from '../support/sdk-request';
import { title } from '../support/sign-in';
import { recordRequests } from '../support/upload-screens';

// What the read-only account is shown by the screens of serving, keys and
// content on a real server: the signature keys screen refuses it with the
// insufficient permissions page and no empty state, the lists of a plugin's
// content show only what the server lets it see, a repository's Content tab
// offers it no way to change anything, and the client snippets of a guarded
// distribution show placeholders.

const enc = encodeURIComponent;

test('the signature keys screen says the account may not see it, and does not read as an empty list', async ({
  page,
}) => {
  await page.goto('signature-keys');
  await expect(title(page, 'Insufficient permissions')).toBeVisible();
  await expect(page.getByText('No signature keys yet')).toHaveCount(0);
  await expect(page.locator('table')).toHaveCount(0);
});

const LISTS = [
  { plugin: 'rpm', api: '/pulp/api/v3/content/rpm/packages/' },
  { plugin: 'file', api: '/pulp/api/v3/content/file/files/' },
  { plugin: 'deb', api: '/pulp/api/v3/content/deb/packages/' },
  { plugin: 'python', api: '/pulp/api/v3/content/python/packages/' },
];

// The number of units the server lists for an account.
async function countFor(
  role: 'admin' | 'viewer',
  path: string,
): Promise<number> {
  const { username, password } = account(role);
  const api = await request.newContext({
    baseURL: origin(),
    extraHTTPHeaders: { Authorization: basicAuthorization(username, password) },
  });
  try {
    return (await apiGet<{ count: number }>(api, path, { limit: '1' })).count;
  } finally {
    await api.dispose();
  }
}

for (const { plugin, api } of LISTS) {
  test(`${plugin}: the content list holds what the server lets the account see, not more, with one read per page`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const seen = await countFor('viewer', api);
    const everything = await countFor('admin', api);
    expect(seen, 'rows the account may see').toBeLessThan(everything);

    const requests = recordRequests(page);
    await page.goto(`${plugin}/content`);
    await expect(
      page.getByRole('heading', { name: /content$/i }).first(),
    ).toBeVisible();
    if (seen === 0) {
      await expect(page.getByText('No content to show')).toBeVisible();
    } else {
      await expect(page.locator('table tbody tr').first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.locator('.pf-v6-c-pagination').first()).toContainText(
        new RegExp(`of\\s+${seen.toLocaleString('en-US')}\\b`),
      );
      await expect(page.locator('table tbody tr')).toHaveCount(
        Math.min(50, seen),
      );
    }
    expect(
      requests.filter((line) => line.startsWith('GET ') && line.includes(api)),
      'list requests of the page',
    ).toHaveLength(1);
    expect(
      requests.filter((line) => line.includes('/pulp/api/v3/repositories/')),
      'requests to a repository',
    ).toEqual([]);
  });
}

test('a repository the account may only read lists its content with no check box and no way to change it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const objects = await TestObjects.open('snipview');
  try {
    const repository = await objects.fileRepository('read', [
      'v1.txt',
      'v2.txt',
    ]);
    const name = repository['name'] as string;
    await page.goto(`file/repositories/${enc(name)}/content`);
    await expect(title(page, name)).toBeVisible();
    await expect(page.getByRole('grid', { name: 'Files' })).toBeVisible();
    await expect(
      page.getByRole('grid', { name: 'Files' }).locator('tbody tr'),
    ).toHaveCount(2);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    for (const action of ['Upload', 'Add content', 'Remove from repository']) {
      await expect(
        page.getByRole('button', { name: action, exact: true }),
      ).toHaveCount(0);
    }
    // nor does a label edit show: changing content labels is a permission the
    // account does not hold
    await expect(
      page.getByRole('button', { name: /^Edit labels of/ }),
    ).toHaveCount(0);
  } finally {
    await objects.cleanUp({ fileContent: true });
  }
});

test('a guarded file distribution shows the snippets with placeholders to the account', async ({
  page,
}) => {
  await page.goto('file/distributions/zz-synth-serving-file-guarded');
  await expect(title(page, 'zz-synth-serving-file-guarded')).toBeVisible();
  const panel = page.locator('[data-cy=DistributionSnippets]');
  await expect(panel).toBeVisible();
  await expect(
    page.getByText('Replace <user> and <token> with an account'),
  ).toBeVisible();
  await expect(panel.locator('[data-language]').first()).toContainText(
    "-u '<user>:<token>'",
  );
  const { username, password } = account('viewer');
  const text =
    (await panel.innerText()) + (await page.locator('body').innerText());
  expect(text).not.toContain(password);
  // the account's own name is shown in the account menu, never in a snippet
  expect(
    await panel.locator('[data-language]').first().textContent(),
  ).not.toContain(username);
});

// The distribution list reads its rows' columns in batches, never one object at
// a time, for the read-only account too, whose rows carry no fix to read
// permissions for. The count is that of one load of the default page, from the
// click on the sidebar entry to every column settled.
test('one load of the distribution list stays within the request budget of a page', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto('status');
  await expect(title(page, 'Status')).toBeVisible();
  const requests = recordRequests(page);
  await page.locator('[data-cy=pulp-menu-item-distributions]').click();
  await expect(
    page.locator(
      'table[aria-label="Distributions"][data-rows-loaded="true"][data-columns-loaded="true"]',
    ),
  ).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(500);
  test.info().annotations.push({
    type: 'requests',
    description: `${requests.length}: ${requests.join(' | ')}`,
  });
  expect(
    requests.filter(
      (line) =>
        line.includes('my_permissions') ||
        /\/([0-9a-f]{8}-[0-9a-f-]{27}|\d+)\/$/i.test(line.split(' ')[1] ?? ''),
    ),
    'requests to one object or to my_permissions',
  ).toEqual([]);
  expect(
    requests.length,
    'API requests of one load of 50 rows',
  ).toBeLessThanOrEqual(16);
});
