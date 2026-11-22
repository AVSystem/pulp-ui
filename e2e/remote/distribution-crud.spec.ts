import { type Page, expect, test } from '@playwright/test';
import { getContentguardsCoreRbacListUrl } from '@pulp-ui/sdk/core/contentguards-rbac';
import { getPublicationsFileFileListUrl } from '@pulp-ui/sdk/file/publications-file';
import { type PulpObject, TestObjects } from '../support/api';
import {
  type DistributionPlugin,
  PLUGINS,
  SERVING_GUARD,
  chooseGuard,
  choosePublic,
  createButton,
  distributionsNamed,
  fillNames,
  findByName,
  listRow,
  openCreateForm,
  openListFiltered,
  pickFromTypeahead,
} from '../support/distribution-screens';
import { title } from '../support/sign-in';

// A distribution of every installed plugin is created, opened, changed and
// deleted through the screens, against a real server, with objects of this
// file's own prefix. The server is asked after each write, so the screen and
// the stored object cannot disagree unnoticed. The lab's shared serving guard
// is read and attached, never changed.

let objects: TestObjects;
let guard: PulpObject;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  objects = await TestObjects.open('dcrud');
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
  await objects.cleanUp();
});

const detailAddress = (plugin: DistributionPlugin, name: string) =>
  new RegExp(`/${plugin}/distributions/${encodeURIComponent(name)}/?$`);

// Reads one distribution of a plugin from the server, failing when it is not
// there exactly once.
async function stored(
  plugin: DistributionPlugin,
  name: string,
): Promise<PulpObject> {
  const found = await distributionsNamed(objects.api, plugin, name);
  expect(found, `${plugin} distributions named ${name}`).toHaveLength(1);
  return found[0] as PulpObject;
}

// Waits until the server no longer lists the distribution: a delete is a task
// the page follows in the background.
async function expectGone(
  plugin: DistributionPlugin,
  name: string,
): Promise<void> {
  await expect
    .poll(
      async () => (await distributionsNamed(objects.api, plugin, name)).length,
      {
        message: `${plugin} distributions named ${name} on the server`,
        timeout: 60_000,
      },
    )
    .toBe(0);
}

// Presses Create and waits for the page of the new distribution, which opens
// when the server has made it.
async function create(
  page: Page,
  plugin: DistributionPlugin,
  name: string,
): Promise<void> {
  await expect(createButton(page)).toBeEnabled();
  await createButton(page).click();
  await expect(page).toHaveURL(detailAddress(plugin, name), {
    timeout: 60_000,
  });
  await expect(title(page, name)).toBeVisible();
  await expect(page.getByText(`Created distribution "${name}"`)).toBeVisible();
}

// Confirms the delete dialog that is open.
async function confirmDelete(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Delete distribution?');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
}

test('a file distribution is created with a guard, switched to one publication, and a public one is marked and listed; both are deleted from the screens', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const repository = await objects.create(PLUGINS.file.repositories, {
    name: objects.name('file-repo'),
  });
  await objects.upload(repository.pulp_href, 'one.txt', 'one');
  const publication = await objects.create(getPublicationsFileFileListUrl(), {
    repository: repository.pulp_href,
  });

  // create with the shared guard and the repository
  const guarded = objects.name('file-guarded');
  await openCreateForm(page, 'file');
  await fillNames(page, guarded);
  await page
    .getByRole('radio', { name: /The repository \(serves its newest/ })
    .check();
  await pickFromTypeahead(
    page,
    'Select a repository',
    repository.name as string,
  );
  await chooseGuard(page, SERVING_GUARD);
  await create(page, 'file', guarded);

  const made = await stored('file', guarded);
  expect(made['repository'], 'the repository it serves').toBe(
    repository.pulp_href,
  );
  expect(made['content_guard'], 'its content guard').toBe(guard.pulp_href);
  expect(made['publication'], 'no publication is bound').toBeNull();

  // switch to one publication: the server then holds the publication and no
  // repository
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/?$/);
  await expect(title(page, guarded)).toBeVisible();
  await page.getByRole('radio', { name: 'One publication' }).check();
  await page.locator('#publication').selectOption(publication.pulp_href);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(detailAddress('file', guarded), {
    timeout: 60_000,
  });
  await expect
    .poll(async () => (await stored('file', guarded))['publication'], {
      message: 'the publication the distribution is bound to',
      timeout: 60_000,
    })
    .toBe(publication.pulp_href);
  const switched = await stored('file', guarded);
  expect(
    switched['repository'],
    'the repository binding is cleared',
  ).toBeNull();
  expect(
    switched['repository_version'],
    'the version binding is cleared',
  ).toBeNull();
  expect(switched['content_guard'], 'the guard was left alone').toBe(
    guard.pulp_href,
  );

  // a public one, by the explicit choice
  const open = objects.name('file-public');
  await openCreateForm(page, 'file');
  await fillNames(page, open);
  await page
    .getByRole('radio', { name: /The repository \(serves its newest/ })
    .check();
  await pickFromTypeahead(
    page,
    'Select a repository',
    repository.name as string,
  );
  await choosePublic(page);
  await create(page, 'file', open);
  // the mark stands beside the address and in the content guard row
  await expect(
    page.locator('[data-cy=DistributionDetail-details]').getByText('Public', {
      exact: true,
    }),
  ).toHaveCount(2);
  expect((await stored('file', open))['content_guard']).toBeNull();

  // the Public mark on the list, and the public-only filter
  await openListFiltered(page, objects.prefix);
  await expect(listRow(page, open)).toContainText('Public');
  await expect(listRow(page, guarded)).not.toContainText('Public');
  await openListFiltered(page, objects.prefix, '&public=true');
  await expect(listRow(page, open)).toBeVisible();
  await expect(listRow(page, guarded)).toHaveCount(0);

  // delete the public one from its page and the guarded one from the list
  await page.goto(`file/distributions/${encodeURIComponent(open)}`);
  await expect(title(page, open)).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await confirmDelete(page);
  await expect(title(page, 'Distributions')).toBeVisible();
  await expectGone('file', open);

  await openListFiltered(page, guarded);
  await listRow(page, guarded).locator('[data-cy=kebab-toggle] button').click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await confirmDelete(page);
  await expectGone('file', guarded);
  await expect(listRow(page, guarded)).toHaveCount(0);
});

const OTHER_PLUGINS: DistributionPlugin[] = [
  'deb',
  'rpm',
  'python',
  'maven',
  'npm',
  'ansible',
  'container',
];

// Plugins that serve from publications ask whether the distribution follows
// the repository or one publication of it.
const SERVES_FROM_PUBLICATION: DistributionPlugin[] = ['file', 'deb', 'rpm'];

for (const plugin of OTHER_PLUGINS) {
  test(`${plugin}: a distribution of a run-scoped repository is created with its protection, opened and deleted`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const repository = await objects.create(PLUGINS[plugin].repositories, {
      name: objects.name(`${plugin}-repo`),
    });
    const name = objects.name(`${plugin}-dist`);

    await openCreateForm(page, plugin);
    await fillNames(page, name);
    if (SERVES_FROM_PUBLICATION.includes(plugin)) {
      await page
        .getByRole('radio', { name: /The repository \(serves its newest/ })
        .check();
    }
    await pickFromTypeahead(
      page,
      'Select a repository',
      repository.name as string,
    );
    if (plugin === 'container') {
      // the server sets the guard of a container distribution; the form offers
      // no protection to choose
      await expect(page.getByRole('radio', { name: /^Public/ })).toHaveCount(0);
      await expect(
        page.getByText(/The server manages the content guard/),
      ).toBeVisible();
    } else {
      await chooseGuard(page, SERVING_GUARD);
    }
    await create(page, plugin, name);

    const made = await stored(plugin, name);
    expect(made['repository'], 'the repository it serves').toBe(
      repository.pulp_href,
    );
    if (plugin === 'container') {
      expect(made['content_guard'], 'the guard the server set').toBeTruthy();
    } else {
      expect(made['content_guard'], 'its content guard').toBe(guard.pulp_href);
    }
    // the page shows what it serves and how it is protected
    const details = page.locator('[data-cy=DistributionDetail-details]');
    await expect(details).toContainText(repository.name as string);
    if (plugin !== 'container') {
      await expect(details).toContainText(SERVING_GUARD);
    }

    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await confirmDelete(page);
    await expect(title(page, 'Distributions')).toBeVisible();
    await expectGone(plugin, name);
  });
}
