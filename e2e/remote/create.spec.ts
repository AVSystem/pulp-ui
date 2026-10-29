import { type Page, expect, test } from '@playwright/test';
import { type PulpObject, TestObjects } from '../support/api';
import { title } from '../support/sign-in';

// The save rules of the repository form, run against a real server with
// objects of this file's own prefix. Plugin: file, except where noted.

const REPOSITORIES = 'repositories/file/file/';
const DISTRIBUTIONS = 'distributions/file/file/';

let objects: TestObjects;

test.beforeAll(async () => {
  objects = await TestObjects.open('create');
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

// The paths of every POST to the API that the page sends.
function recordPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() === 'POST' && pathname.startsWith('/pulp/api/')) {
      posts.push(pathname);
    }
  });
  return posts;
}

const save = (page: Page) => page.getByRole('button', { name: 'Save' });

async function openCreateForm(page: Page, name: string) {
  await page.goto('file/repositories/edit/_');
  await page.locator('#name').fill(name);
  await expect(page.locator('#create_distribution')).not.toBeChecked();
}

// Ticks the box and types a base path.
async function offerDistribution(page: Page, basePath?: string) {
  await page.locator('#create_distribution').check();
  if (basePath !== undefined) {
    await page.locator('#base_path').fill(basePath);
  }
}

test('saving an edit creates no distribution and sends no POST', async ({
  page,
}) => {
  const repository = await objects.create(REPOSITORIES, {
    name: objects.name('edit'),
  });
  const distributions = await Promise.all(
    ['one', 'two'].map((suffix) =>
      objects.create(DISTRIBUTIONS, {
        name: objects.name(`edit-${suffix}`),
        base_path: objects.name(`edit-${suffix}`),
        repository: repository.pulp_href,
      }),
    ),
  );

  const posts = recordPosts(page);
  await page.goto(`file/repositories/edit/${repository.name}`);
  // the form lists what serves the repository once it has loaded it
  for (const distribution of distributions) {
    await expect(page.getByText(distribution.name as string)).toBeVisible();
  }

  await page.locator('#description').fill('changed by the browser test');
  await save(page).click();
  await page.waitForURL(/repositories\/detail\//);
  await expect(title(page, repository.name as string)).toBeVisible();

  expect(posts, 'POST requests of the page').toEqual([]);
  expect(
    await objects.list(DISTRIBUTIONS, {
      name__startswith: objects.prefix,
      fields: 'pulp_href',
    }),
    'distributions of this file after the save',
  ).toHaveLength(2);
  expect(
    ((await objects.get(repository.pulp_href)) as PulpObject)['description'],
    'the save went through',
  ).toBe('changed by the browser test');
});

test('a base path or name that is taken is refused before any POST', async ({
  page,
}) => {
  const taken = await objects.create(DISTRIBUTIONS, {
    name: objects.name('taken'),
    base_path: `${objects.name('nest')}/inner`,
  });
  const takenPath = taken['base_path'] as string;
  const posts = recordPosts(page);

  // the same path, a path below it and a path above it all overlap
  for (const [suffix, basePath] of [
    ['same', takenPath],
    ['below', `${takenPath}/sub`],
    ['above', objects.name('nest')],
  ] as const) {
    await openCreateForm(page, objects.name(`path-${suffix}`));
    await offerDistribution(page, basePath);
    await save(page).click();
    await expect(
      page.getByText(/is already used by or overlaps the distribution/),
      `base path ${suffix}`,
    ).toBeVisible();
  }

  // a name that a distribution already has
  await openCreateForm(page, taken.name as string);
  await offerDistribution(page, objects.name('free'));
  await save(page).click();
  await expect(
    page.getByText(/A distribution named .* already exists/),
  ).toBeVisible();

  expect(posts, 'POST requests of the page').toEqual([]);
  // none of the refused saves left a repository behind
  const filters: Record<string, string>[] = [
    { name__startswith: objects.name('path-') },
    { name: taken.name as string },
  ];
  for (const filter of filters) {
    expect(
      await objects.list(REPOSITORIES, { ...filter, fields: 'pulp_href' }),
      `repositories matching ${JSON.stringify(filter)}`,
    ).toHaveLength(0);
  }
});

test('a base path under a prefix the deployment reserves is refused', async ({
  page,
}) => {
  // the list the deployment serves to the UI, not a copy of it
  const response = await objects.api.get('/pulp-ui-config.json');
  const prefixes: string[] =
    ((await response.json()) as { RESERVED_BASE_PATH_PREFIXES?: string[] })
      .RESERVED_BASE_PATH_PREFIXES ?? [];
  test.skip(!prefixes.length, 'the deployment reserves no base path prefix');

  const posts = recordPosts(page);
  await openCreateForm(page, objects.name('reserved'));
  for (const prefix of prefixes) {
    await offerDistribution(
      page,
      `${prefix.replace(/\/+$/, '')}/${objects.name('reserved')}`,
    );
    await expect(
      page.getByText(/are reserved on this server/),
      `prefix ${prefix}`,
    ).toBeVisible();
    await expect(save(page)).toBeDisabled();
  }

  // a path a seeded installation already serves is refused as well
  const [seeded] = await objects.list('distributions/deb/apt/', {
    name__startswith: 'zz-synth-',
    fields: 'base_path',
  });
  await page.locator('#base_path').fill(seeded?.['base_path'] as string);
  await expect(save(page)).toBeDisabled();

  expect(posts, 'POST requests of the page').toEqual([]);
});

test('the default base path is the name and the preview is the URL the server then reports', async ({
  page,
}) => {
  const name = objects.name('make');
  await openCreateForm(page, name);
  await offerDistribution(page);

  await expect(page.locator('#base_path')).toHaveValue(name);
  const preview = page.getByText(/URL \(preview\): /);
  await expect(preview).toBeVisible();
  const previewed = (await preview.innerText()).replace(
    /^URL \(preview\):\s*/,
    '',
  );

  await save(page).click();
  await page.waitForURL(/repositories\/detail\//);

  const [created] = await objects.list(DISTRIBUTIONS, {
    name,
    fields: 'pulp_href,name,base_path,base_url,repository',
  });
  expect(created, 'the distribution exists').toBeDefined();
  objects.track((created as PulpObject).pulp_href);
  expect(created?.['base_path']).toBe(name);
  expect(created?.['base_url']).toBe(previewed);
});

test('a double click on Save sends one repository POST', async ({ page }) => {
  const name = objects.name('double');
  const posts = recordPosts(page);
  await openCreateForm(page, name);

  await save(page).dblclick();
  await page.waitForURL(/repositories\/detail\//);

  expect(
    posts.filter((path) => path.endsWith(`/${REPOSITORIES}`)),
    'POST requests to the repository endpoint',
  ).toHaveLength(1);
  expect(await objects.list(REPOSITORIES, { name })).toHaveLength(1);
});
