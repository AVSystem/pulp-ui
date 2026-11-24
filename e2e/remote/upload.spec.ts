import { expect, test } from '@playwright/test';
import { getContentFileFilesListUrl } from '@pulp-ui/sdk/file/content-files';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { createHash, randomBytes } from 'node:crypto';
import { TestObjects } from '../support/api';
import { PLUGINS } from '../support/distribution-screens';
import { deb, rpm, wheel } from '../support/packages';
import {
  MiB,
  chooseFiles,
  fileRow,
  openUploadDialog,
  recordRequests,
  uploadCount,
  versionPaths,
} from '../support/upload-screens';

// Uploading files on a real server as the administrator: several small files
// make one new version, a file above the chunk threshold goes through an upload
// object that is gone afterwards, a file the server refuses leaves the
// repository alone, and cancelling a chunked upload leaves no upload object.
// The files are generated here; their paths carry the run's prefix so the
// clean-up removes the units.

let objects: TestObjects;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(120_000);
  objects = await TestObjects.open('upload');
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  await objects?.cleanUp({ fileContent: true });
});

const small = (name: string, text: string) => ({
  name,
  buffer: Buffer.from(`${objects.prefix}${text}\n`),
  path: objects.path(name),
});

test('three files make exactly one new version that lists all three', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('multi'),
  });
  const files = ['u1.txt', 'u2.txt', 'u3.txt'].map((name) => small(name, name));

  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, files);
  await expect(
    dialog.getByText('All files are added in one new repository version'),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(dialog.getByText('3 files added')).toBeVisible({
    timeout: 120_000,
  });
  for (const { name } of files) {
    await expect(fileRow(dialog, name)).toContainText('Added');
  }
  await dialog.getByRole('button', { name: 'Done' }).click();

  const numbers = await objects.versionNumbers(repository.pulp_href);
  expect(numbers, 'one new version after three files').toEqual([1, 0]);
  expect(
    await versionPaths(objects, `${repository.pulp_href}versions/1/`),
  ).toEqual(files.map(({ path }) => path).sort());
});

test('a file above the chunk threshold goes through an upload and the content is the bytes sent', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('chunked'),
  });
  const buffer = randomBytes(20 * MiB);
  const digest = createHash('sha256')
    .update(new Uint8Array(buffer))
    .digest('hex');
  const path = objects.path('big.bin');
  const before = await uploadCount(objects);
  const requests = recordRequests(page);

  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, [{ name: 'big.bin', buffer, path }]);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(fileRow(dialog, 'big.bin')).toContainText('Added', {
    timeout: 240_000,
  });
  await expect(dialog.getByText('1 file added')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();

  // the file went in parts through an upload object
  expect(
    requests.filter((line) => line.startsWith('POST /pulp/api/v3/uploads/')),
    'requests that make an upload',
  ).not.toHaveLength(0);
  expect(
    requests.filter((line) => line.startsWith('PUT /pulp/api/v3/uploads/')),
    'requests that send a part',
  ).toHaveLength(5);

  // the content is the bytes that were sent, in one new version
  const [unit] = await objects.list(getContentFileFilesListUrl(), {
    relative_path: path,
    fields: 'pulp_href,sha256,relative_path',
  });
  expect(unit?.['sha256'], 'checksum of the stored file').toBe(digest);
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([1, 0]);

  // and the upload object is gone
  await expect
    .poll(() => uploadCount(objects), {
      message: 'upload objects after the upload',
      timeout: 60_000,
    })
    .toBe(before);
});

test('a file the server refuses leaves the repository alone, and a second try with good paths makes one version', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('refused'),
  });
  const name = repository['name'] as string;
  const r1 = small('r1.txt', 'r1.txt');
  const r2 = small('r2.txt', 'r2.txt');
  const good = [r1, r2];
  const bad = { ...small('bad.txt', 'bad.txt'), path: '../bad.txt' };

  const dialog = await openUploadDialog(page, name);
  await chooseFiles(dialog, [r1, bad, r2]);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(
    dialog.getByText('Nothing was added to the repository'),
  ).toBeVisible({ timeout: 120_000 });
  // the refused file shows the server's reason; the others were not added
  await expect(fileRow(dialog, 'bad.txt')).toContainText('Failed');
  await expect(fileRow(dialog, 'r1.txt')).toContainText('Not added');
  await expect(fileRow(dialog, 'r2.txt')).toContainText('Not added');
  await dialog.getByRole('button', { name: 'Done' }).click();

  expect(
    await objects.versionNumbers(repository.pulp_href),
    'no version was added',
  ).toEqual([0]);
  // the two files that were made stay as content that belongs to no repository
  const made = await objects.list(getContentFileFilesListUrl(), {
    relative_path__startswith: objects.path('r'),
    fields: 'pulp_href,relative_path',
  });
  expect(made.map(({ relative_path }) => relative_path).sort()).toEqual(
    good.map(({ path }) => path).sort(),
  );

  // the same files with good paths make one version
  const again = await openUploadDialog(page, name);
  await chooseFiles(again, [...good, small('r3.txt', 'r3.txt')]);
  await again.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(again.getByText('3 files added')).toBeVisible({
    timeout: 120_000,
  });
  await again.getByRole('button', { name: 'Done' }).click();
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([1, 0]);
  expect(
    await versionPaths(objects, `${repository.pulp_href}versions/1/`),
  ).toHaveLength(3);
});

test('cancelling a chunked upload, even before the server has answered, leaves no upload object and no version', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('cancel'),
  });
  const before = await uploadCount(objects);
  // The server makes the upload as soon as it has the request; its answer is
  // held back so that the cancel lands while the page does not yet know the
  // upload's address, the case a cancel must not leave an upload behind.
  await page.route('**/pulp/api/v3/uploads/', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ response }).catch(() => undefined);
  });
  const dialog = await openUploadDialog(page, repository['name'] as string);
  await chooseFiles(dialog, [
    {
      name: 'huge.bin',
      buffer: randomBytes(48 * MiB),
      path: objects.path('huge.bin'),
    },
  ]);
  await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
  // a bar that moves, then cancel through the button and its confirmation
  await expect(
    dialog.getByRole('progressbar', { name: 'Upload of huge.bin' }),
  ).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel upload' }).click();
  await dialog.getByRole('button', { name: 'Stop uploading' }).click();
  await expect(fileRow(dialog, 'huge.bin')).toContainText('Canceled', {
    timeout: 60_000,
  });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await expect
    .poll(() => uploadCount(objects), {
      message: 'upload objects after the cancel',
      timeout: 60_000,
    })
    .toBe(before);
  expect(await objects.versionNumbers(repository.pulp_href)).toEqual([0]);
});

// A package of each kind is sent through the dialog into a repository of its
// plugin, and the repository's Content tab lists it afterwards. The package
// is generated here and carries the run's prefix in its name.
const PACKAGES = [
  {
    plugin: 'python' as const,
    make: () => wheel(`${objects.prefix}pkg`),
  },
  {
    plugin: 'deb' as const,
    make: () => deb(`${objects.prefix}pkg`),
  },
  {
    plugin: 'rpm' as const,
    make: () => rpm(`${objects.prefix}pkg`),
  },
];

for (const { plugin, make } of PACKAGES) {
  test(`${plugin}: a generated package is added through the dialog and the Content tab lists it`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const repository = await objects.create(PLUGINS[plugin].repositories, {
      name: objects.name(`${plugin}-pkg`),
    });
    const generated = make();

    const dialog = await openUploadDialog(
      page,
      repository['name'] as string,
      plugin,
    );
    await chooseFiles(dialog, [
      { name: generated.fileName, buffer: generated.buffer },
    ]);
    await dialog.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(dialog.getByText('1 file added')).toBeVisible({
      timeout: 120_000,
    });
    await dialog.getByRole('button', { name: 'Done' }).click();

    expect(await objects.versionNumbers(repository.pulp_href)).toEqual([1, 0]);
    const units = await objects.versionContent(
      `${repository.pulp_href}versions/1/`,
    );
    expect(units, 'content of the new version').toHaveLength(1);
    objects.trackContent(units);

    // the tab lists the package under its own name
    await expect(page.getByRole('grid').first()).toContainText(
      objects.prefix.replace(/-$/, ''),
      { timeout: 60_000 },
    );
  });
}
