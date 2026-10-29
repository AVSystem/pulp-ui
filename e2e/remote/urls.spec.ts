import { type Page, expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// The repository page shows the URL the server reports for each distribution
// (never one built from the base path) and flags a distribution that has
// nothing to serve. Every expectation is read from the API at run time; the
// seeded installations are only read, never written.

interface Distribution extends PulpObject {
  name: string;
  base_path: string;
  base_url: string;
  publication: string | null;
  repository: string | null;
}

interface Installation {
  repositoryName: string;
  distributions: (Distribution & { served: boolean })[];
}

const NOT_SERVED = 'Not served: no publication';

// A repository version href belongs to the repository it ends with.
function repositoryOfVersion(versionHref: string): string {
  return versionHref.replace(/versions\/\d+\/?$/, '');
}

let objects: TestObjects;
const found: {
  publication?: Installation;
  repositoryBoundPublished?: Installation;
  notServed?: Installation;
} = {};

test.beforeAll(async () => {
  objects = await TestObjects.open('urls');

  const distributions = (await objects.list('distributions/deb/apt/', {
    name__startswith: 'zz-synth-',
    fields: 'pulp_href,name,base_path,base_url,publication,repository',
  })) as Distribution[];
  const publications = await objects.list('publications/deb/apt/', {
    fields: 'pulp_href,repository_version',
  });

  const repositoryOfPublication = new Map(
    publications.map((publication) => [
      publication.pulp_href,
      repositoryOfVersion(publication.repository_version as string),
    ]),
  );
  const published = new Set(repositoryOfPublication.values());

  const byRepository = new Map<string, Distribution[]>();
  for (const distribution of distributions) {
    const repository =
      distribution.repository ??
      repositoryOfPublication.get(distribution.publication ?? '');
    if (repository) {
      byRepository.set(repository, [
        ...(byRepository.get(repository) ?? []),
        distribution,
      ]);
    }
  }

  async function installation(repositoryHref: string): Promise<Installation> {
    const { name } = await objects.get(repositoryHref);
    return {
      repositoryName: name as string,
      distributions: (byRepository.get(repositoryHref) ?? []).map(
        (distribution) => ({
          ...distribution,
          // a distribution bound to a publication serves it, one bound to the
          // repository serves once the repository has a publication
          served: !!distribution.publication || published.has(repositoryHref),
        }),
      ),
    };
  }

  for (const [repository, own] of byRepository) {
    if (!found.publication && own.some((d) => d.publication)) {
      found.publication = await installation(repository);
    }
    if (
      !found.repositoryBoundPublished &&
      published.has(repository) &&
      own.some((d) => d.repository && !d.publication)
    ) {
      found.repositoryBoundPublished = await installation(repository);
    }
    if (!found.notServed && !published.has(repository) && own.length) {
      found.notServed = await installation(repository);
    }
  }
});

test.afterAll(async () => {
  await objects.cleanUp();
});

async function expectUrlsAndLabels(
  page: Page,
  { repositoryName, distributions }: Installation,
) {
  await page.goto(`deb/repositories/detail/${repositoryName}`);
  await expect(title(page, repositoryName)).toBeVisible();

  const details = page.locator('.pf-v5-c-description-list__group', {
    hasText: 'Repository URL',
  });
  for (const { base_url } of distributions) {
    await expect(details.getByText(base_url, { exact: true })).toBeVisible();
  }
  await expect(details.getByText(NOT_SERVED)).toHaveCount(
    distributions.filter((distribution) => !distribution.served).length,
  );

  await page.goto(
    `deb/repositories/detail/${repositoryName}?tab=distributions`,
  );
  for (const { name, base_url, served } of distributions) {
    const row = page.getByRole('row').filter({
      has: page.getByRole('gridcell', { name, exact: true }),
    });
    await expect(row.getByText(base_url, { exact: true })).toBeVisible();
    await expect(row.getByText(NOT_SERVED)).toHaveCount(served ? 0 : 1);
  }
}

test('a repository served from a publication shows the base_url the API returns', async ({
  page,
}) => {
  const installation = found.publication;
  test.skip(!installation, 'no seeded repository is served from a publication');
  await expectUrlsAndLabels(page, installation as Installation);
});

test('a repository-bound distribution of a published repository shows its base_url and no label', async ({
  page,
}) => {
  const installation = found.repositoryBoundPublished;
  test.skip(
    !installation,
    'no seeded repository has a publication and a repository-bound distribution',
  );
  await expectUrlsAndLabels(page, installation as Installation);
});

test('a distribution with nothing to serve shows its base_url and the not-served label', async ({
  page,
}) => {
  const installation = found.notServed;
  test.skip(!installation, 'every seeded distribution is served');
  expect(
    (installation as Installation).distributions.every((d) => !d.served),
  ).toBe(true);
  await expectUrlsAndLabels(page, installation as Installation);
});
