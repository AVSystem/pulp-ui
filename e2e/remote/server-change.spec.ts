import { expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// A distribution that is deleted or re-bound on the server while a repository
// page is open is still shown by that page (nothing is fetched behind the
// user's back) and is gone after a reload, from the details, the Distributions
// tab and the edit form alike.

const NOT_SERVED = 'Not served: no publication';

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('chg');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

test('a distribution deleted or re-bound on the server leaves the page after a reload', async ({
  page,
}) => {
  const repository = await objects.create('repositories/deb/apt/', {
    name: objects.name('a'),
  });
  const other = await objects.create('repositories/deb/apt/', {
    name: objects.name('b'),
  });
  const publication = await objects.create('publications/deb/apt/', {
    repository_version: repository['latest_version_href'],
  });
  const published = await objects.create('distributions/deb/apt/', {
    name: objects.name('published'),
    base_path: objects.name('published'),
    publication: publication.pulp_href,
  });
  const bound = await objects.create('distributions/deb/apt/', {
    name: objects.name('bound'),
    base_path: objects.name('bound'),
    repository: repository.pulp_href,
  });

  const detailPath = (name: string) => `deb/repositories/detail/${name}`;
  const details = page.locator('.pf-v5-c-description-list__group', {
    hasText: 'Repository URL',
  });
  const row = (distribution: PulpObject) =>
    page.getByRole('row').filter({
      has: page.getByRole('gridcell', {
        name: distribution.name as string,
        exact: true,
      }),
    });

  // 1. both distributions are shown, in Details and in the Distributions tab
  await page.goto(detailPath(repository.name as string));
  await expect(title(page, repository.name as string)).toBeVisible();
  for (const distribution of [published, bound]) {
    await expect(
      details.getByText(distribution['base_url'] as string, { exact: true }),
    ).toBeVisible();
  }
  await page.goto(`${detailPath(repository.name as string)}?tab=distributions`);
  await expect(row(published)).toHaveCount(1);
  await expect(row(bound)).toHaveCount(1);
  await page.goto(`deb/repositories/edit/${repository.name}`);
  await expect(page.getByText(published.name as string)).toBeVisible();

  // 2. the page stays open on the repository while the server changes
  await page.goto(detailPath(repository.name as string));
  for (const distribution of [published, bound]) {
    await expect(
      details.getByText(distribution['base_url'] as string, { exact: true }),
    ).toBeVisible();
  }
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/pulp/api/')) {
      requests.push(`${request.method()} ${request.url()}`);
    }
  });

  await objects.remove(published.pulp_href);
  await objects.patch(bound.pulp_href, { repository: other.pulp_href });

  // 3. nothing refetches behind the user's back: the old state stays
  await page.waitForTimeout(2500);
  for (const distribution of [published, bound]) {
    await expect(
      details.getByText(distribution['base_url'] as string, { exact: true }),
    ).toBeVisible();
  }
  expect(requests, 'API requests while the page was left open').toEqual([]);

  // 4. after a reload both are gone from the details ...
  await page.reload();
  await expect(title(page, repository.name as string)).toBeVisible();
  await expect(details).toContainText('None');
  for (const distribution of [published, bound]) {
    await expect(
      page.getByText(distribution['base_url'] as string),
    ).toHaveCount(0);
  }

  // ... from the Distributions tab ...
  await page.goto(`${detailPath(repository.name as string)}?tab=distributions`);
  await expect(
    page.getByText('No distribution serves this repository'),
  ).toBeVisible();
  await expect(row(published)).toHaveCount(0);
  await expect(row(bound)).toHaveCount(0);

  // ... and from the edit form
  await page.goto(`deb/repositories/edit/${repository.name}`);
  const group = page.locator('.pf-v5-c-form__group', {
    has: page.locator('label[for=distributions]'),
  });
  await expect(group).toContainText('None');
  for (const distribution of [published, bound]) {
    await expect(group).not.toContainText(distribution.name as string);
  }

  // the re-bound distribution now belongs to the other repository's page,
  // with the URL the server reports for it, and is not served there
  await page.goto(`${detailPath(other.name as string)}`);
  await expect(
    details.getByText(bound['base_url'] as string, { exact: true }),
  ).toBeVisible();
  await expect(details.getByText(NOT_SERVED)).toHaveCount(1);
});
