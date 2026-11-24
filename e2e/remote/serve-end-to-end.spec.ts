import { type Page, expect, request, test } from '@playwright/test';
import { getContentguardsCoreRbacListUrl } from '@pulp-ui/sdk/core/contentguards-rbac';
import { readFileSync } from 'node:fs';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
import {
  SERVING_GUARD,
  chooseGuard,
  choosePublic,
  createButton,
  distributionsNamed,
  fillNames,
  findByName,
} from '../support/distribution-screens';
import { title } from '../support/sign-in';

// A repository goes from created to served and downloaded entirely through the
// screens, against a real server: create the repository, upload a file, publish
// it, serve it through a distribution protected by a content guard that the
// user chose, and download the file from the address the page shows with the
// credentials the client snippet asks for. A second distribution chosen Public
// is downloaded by plain navigation. No command line tool is involved. The
// credentials are built from the accounts file when a download is made and
// are never written anywhere.

let objects: TestObjects;
let guard: PulpObject;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  objects = await TestObjects.open('serve');
  const found = await findByName(
    objects.api,
    getContentguardsCoreRbacListUrl(),
    SERVING_GUARD,
  );
  expect(
    found,
    `the lab holds the content guard ${SERVING_GUARD}`,
  ).toBeTruthy();
  guard = found as PulpObject;
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects?.cleanUp({ fileContent: true });
});

const REPOSITORY_NAME = () => objects.name('repo');
// the path carries the run's prefix, so the unit is removed with the run
const filePath = () => `${objects.prefix}served/hello.txt`;

// The generated file: text that carries the run's prefix so no other run's
// content is the same unit.
const fileText = () => `${objects.prefix}served end to end\n`;

// The address shown beside "Client URL" on a distribution's page, as text.
async function shownUrl(page: Page): Promise<string> {
  const details = page.locator('[data-cy=DistributionDetail-details]');
  const code = details.locator('.pf-v6-c-clipboard-copy__text').first();
  await expect(code).toBeVisible();
  const text = (await code.textContent())?.trim() ?? '';
  expect(text, 'the client URL on the page').toMatch(/^https?:\/\//);
  return text;
}

// Creates a distribution of the repository from the repository's Distributions
// tab, with the protection the callback chooses, and waits for its page.
async function createDistribution(
  page: Page,
  name: string,
  protect: () => Promise<void>,
): Promise<void> {
  await page.getByRole('button', { name: 'Create distribution' }).click();
  await expect(title(page, 'Create distribution')).toBeVisible();
  await fillNames(page, name);
  // the repository is the one the tab was opened from
  await page
    .getByRole('radio', { name: /The repository \(serves its newest/ })
    .check();
  await protect();
  await expect(createButton(page)).toBeEnabled();
  await createButton(page).click();
  await expect(page).toHaveURL(
    new RegExp(`/file/distributions/${encodeURIComponent(name)}/?$`),
    { timeout: 60_000 },
  );
  await expect(title(page, name)).toBeVisible();
}

test('a repository is created, filled, published and served through the screens, and the file is downloaded with credentials', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const name = REPOSITORY_NAME();

  // create the repository: the form offers a distribution, left unchecked
  await page.goto('file/repository/new');
  await page.locator('#name').fill(name);
  await expect(page.locator('#create_distribution')).not.toBeChecked();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(
    new RegExp(`/file/repositories/${encodeURIComponent(name)}/?$`),
  );
  await expect(title(page, name)).toBeVisible();

  // upload one generated file on the Content tab
  await page
    .locator('#main-content')
    .getByRole('link', { name: 'Content', exact: true })
    .click();
  await page.getByRole('button', { name: 'Upload', exact: true }).click();
  const upload = page.getByRole('dialog');
  await expect(upload).toContainText('Upload files');
  await upload.locator('input[type=file]').setInputFiles({
    name: 'hello.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(fileText()),
  });
  await upload.getByLabel('Relative path of hello.txt').fill(filePath());
  await upload.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(upload.getByText('1 file added')).toBeVisible({
    timeout: 120_000,
  });
  await upload.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('grid', { name: 'Files' })).toContainText(
    filePath(),
  );

  // publish the repository and wait for the finished alert
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const publish = page.locator('[data-cy=PublishDialog]');
  await expect(publish).toContainText(`Publish repository "${name}"`);
  await publish.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(publish).toHaveCount(0);
  await expect(page.getByText(`Publish of ${name} finished.`)).toBeVisible({
    timeout: 120_000,
  });

  // serve it through a distribution protected by the content guard
  await page
    .locator('#main-content')
    .getByRole('link', { name: 'Distributions', exact: true })
    .click();
  const guarded = objects.name('guarded');
  await createDistribution(page, guarded, () =>
    chooseGuard(page, SERVING_GUARD),
  );
  const made = (await distributionsNamed(objects.api, 'file', guarded))[0];
  expect(made?.['content_guard'], 'the guard the user chose').toBe(
    guard.pulp_href,
  );

  // the page's address is a download address once the file path is appended
  const url = await shownUrl(page);
  const { username, password } = account('admin');
  const client = await request.newContext({
    extraHTTPHeaders: {
      Authorization: basicAuthorization(username, password),
    },
  });
  try {
    // the content app may take a moment to know a new distribution
    await expect
      .poll(async () => (await client.get(`${url}${filePath()}`)).status(), {
        message: 'download with credentials',
        timeout: 60_000,
      })
      .toBe(200);
    const body = await (await client.get(`${url}${filePath()}`)).body();
    expect(body.toString('utf8')).toBe(fileText());
    test.info().annotations.push({
      type: 'downloaded',
      description: `${body.length} bytes`,
    });

    // without credentials the guard refuses
    const anonymous = await request.newContext();
    try {
      const refused = await anonymous.get(`${url}${filePath()}`);
      expect([401, 403], 'download without credentials').toContain(
        refused.status(),
      );
    } finally {
      await anonymous.dispose();
    }
  } finally {
    await client.dispose();
  }

  // the copied curl line holds that address and placeholders only
  const snippets = page.locator('[data-cy=DistributionSnippets]');
  await expect(snippets).toBeVisible();
  const curl = (
    await snippets.locator('pre code, code').first().textContent()
  )?.trim();
  expect(curl, 'the curl snippet').toBe(
    `curl -fSLO -u '<user>:<token>' '${url}<path>'`,
  );
  expect(curl).not.toContain(username);
  expect(curl).not.toContain(password);
  await expect(
    snippets.getByRole('button', { name: 'Copy to clipboard' }),
  ).toBeVisible();

  // a second distribution, chosen Public, is downloaded by plain navigation
  await page.goto(
    `file/repositories/${encodeURIComponent(name)}/distributions`,
  );
  const open = objects.name('public');
  await createDistribution(page, open, () => choosePublic(page));
  expect(
    (await distributionsNamed(objects.api, 'file', open))[0]?.['content_guard'],
  ).toBeNull();
  const openUrl = await shownUrl(page);
  // the content app answers a file with a download, which the browser saves
  const downloading = page.waitForEvent('download');
  await page.goto(`${openUrl}${filePath()}`).catch(() => undefined);
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('hello.txt');
  const saved = await download.path();
  expect(readFileSync(saved, 'utf8'), 'the public download').toBe(fileText());
});
