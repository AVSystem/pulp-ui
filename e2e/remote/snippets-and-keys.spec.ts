import {
  type APIRequestContext,
  type Locator,
  type Page,
  expect,
  test,
} from '@playwright/test';
import { getContentFileFilesSetLabelUrl } from '@pulp-ui/sdk/file/content-files';
import { createHash } from 'node:crypto';
import { account } from '../support/accounts';
import { type PulpObject, TestObjects } from '../support/api';
import { PLUGINS } from '../support/distribution-screens';
import { wheel } from '../support/packages';
import { apiGet, apiPost } from '../support/sdk-request';
import { title } from '../support/sign-in';
import { recordRequests } from '../support/upload-screens';

// The client snippets, the signature keys screen and the lists of a plugin's
// content on a real server, as the administrator. The seeded serving
// distributions of the lab stand for every plugin; the public entry points a
// deployment names are read from the configuration the server itself serves and
// never written into this file; the objects a check needs of its own carry the
// run's prefix.

const enc = encodeURIComponent;

let objects: TestObjects;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  objects = await TestObjects.open('snip');
});

test.afterAll(async () => {
  test.setTimeout(240_000);
  await objects?.cleanUp({ fileContent: true });
});

const panel = (page: Page): Locator =>
  page.locator('[data-cy=DistributionSnippets]');

// The text of the snippet a tab of the panel holds.
async function snippetOf(page: Page, tab: string): Promise<string> {
  await panel(page).getByRole('tab', { name: tab, exact: true }).click();
  const code = panel(page).locator('[data-language]').first();
  await expect(code).toBeVisible();
  return (await code.textContent()) ?? '';
}

async function openDistribution(
  page: Page,
  plugin: string,
  name: string,
): Promise<void> {
  await page.goto(`${plugin}/distributions/${enc(name)}`);
  await expect(title(page, name)).toBeVisible();
  await expect(panel(page)).toBeVisible();
}

// The tabs of the panel, in order.
const tabsOf = (page: Page): Promise<string[]> =>
  panel(page).getByRole('tab').allInnerTexts();

// What every plugin's seeded serving distribution shows: the tabs a snippet
// panel always has, whatever the distribution is bound to.
const SEEDED = [
  {
    plugin: 'file',
    name: 'zz-synth-serving-file-guarded',
    tabs: ['curl', 'wget', 'CLI configuration'],
  },
  {
    plugin: 'deb',
    name: 'zz-synth-serving-deb-repo-fresh',
    tabs: ['APT sources', 'CLI configuration'],
  },
  {
    plugin: 'rpm',
    name: 'zz-synth-serving-rpm-repo-fresh',
    tabs: ['Repository file', 'CLI configuration'],
  },
  {
    plugin: 'python',
    name: 'zz-synth-serving-python-repo',
    tabs: ['Install with pip', 'pip.conf', 'Upload with twine'],
  },
  {
    plugin: 'maven',
    name: 'zz-synth-serving-maven-repo',
    tabs: ['settings.xml', 'Gradle'],
  },
  {
    plugin: 'npm',
    name: 'zz-synth-serving-npm-repo',
    tabs: ['.npmrc', 'Publish with npm'],
  },
  {
    plugin: 'ansible',
    name: 'zz-synth-serving-ansible-repo',
    tabs: ['ansible.cfg', 'Install a collection', 'Publish a collection'],
  },
  {
    plugin: 'container',
    name: 'zz-synth-serving-container-repo',
    tabs: ['Log in', 'Pull', 'Push'],
  },
];

for (const { plugin, name, tabs } of SEEDED) {
  test(`${plugin}: the distribution page shows its client snippets with a copy button and no credential`, async ({
    page,
  }) => {
    await openDistribution(page, plugin, name);
    const shown = await tabsOf(page);
    for (const tab of tabs) {
      expect(shown, `tabs of the ${plugin} snippet panel`).toContain(tab);
    }
    await expect(
      panel(page).getByRole('button', { name: 'Copy to clipboard' }),
    ).toBeVisible();

    // no tab ever holds the account that is signed in or its secret
    const { username, password } = account('admin');
    for (const tab of shown) {
      const text = await snippetOf(page, tab);
      expect(text, `${plugin} snippet ${tab}`).not.toContain(username);
      expect(text, `${plugin} snippet ${tab}`).not.toContain(password);
    }
  });
}

test('a guarded file distribution shows only the credential placeholders, a public one none', async ({
  page,
}) => {
  await openDistribution(page, 'file', 'zz-synth-serving-file-guarded');
  await expect(
    page.getByText('Replace <user> and <token> with an account'),
  ).toBeVisible();
  expect(await snippetOf(page, 'curl')).toContain("-u '<user>:<token>'");
  expect(await snippetOf(page, 'wget')).toContain("--user '<user>'");

  await openDistribution(page, 'file', 'zz-synth-serving-file-public');
  await expect(page.getByText('Replace <user> and <token>')).toHaveCount(0);
  const curl = await snippetOf(page, 'curl');
  expect(curl).not.toContain('<user>');
  expect(curl).toMatch(/^curl -fSLO 'https?:\/\/.*<path>'$/);
});

// Where a deployment's entry point says clients read and write, resolved the
// way the page does: against the origin, the base path put in place.
interface EntryPoint {
  plugin: string;
  basePaths?: string[];
  basePathPrefix?: string;
  read: string;
  write?: string;
  signingKey?: string;
  suite?: string;
  components?: string[];
}

async function entryPoints(api: APIRequestContext): Promise<EntryPoint[]> {
  const config = await apiGet<{ CLIENT_ENTRY_POINTS?: EntryPoint[] }>(
    api,
    '/pulp-ui-config.json',
  );
  return config.CLIENT_ENTRY_POINTS ?? [];
}

const resolved = (
  address: string,
  basePath: string,
  origin: string,
): string => {
  const filled = address.replace(
    '{base_path}',
    basePath.split('/').map(enc).join('/'),
  );
  const url = new URL(filled, origin).href;
  return url.endsWith('/') ? url : `${url}/`;
};

// The first lab distribution of a plugin whose base path an entry point names.
async function labDistribution(
  entry: EntryPoint,
): Promise<{ name: string; base_path: string }> {
  const path = PLUGINS[entry.plugin as keyof typeof PLUGINS].distributions;
  const names = entry.basePaths ?? [];
  const prefix = entry.basePathPrefix ?? '';
  const all = await objects.list(path, {
    ...(names.length > 0
      ? { base_path__in: names.join(',') }
      : { base_path__contains: prefix }),
    fields: 'name,base_path',
  });
  const found = all.filter(
    ({ base_path }) =>
      names.includes(String(base_path)) || String(base_path).startsWith(prefix),
  );
  expect(
    found,
    `a lab distribution under the ${entry.plugin} entry point`,
  ).not.toHaveLength(0);
  const [first] = found as unknown as { name: string; base_path: string }[];
  return first as { name: string; base_path: string };
}

test('every entry point the server names shows on the snippets of a distribution under it', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const entries = await entryPoints(objects.api);
  expect(entries, 'entry points in the served configuration').not.toHaveLength(
    0,
  );
  await page.goto('status');
  const base = new URL(page.url()).origin;

  for (const entry of entries) {
    const lab = await labDistribution(entry);
    await openDistribution(page, entry.plugin, lab.name);
    const read = resolved(entry.read, lab.base_path, base);

    switch (entry.plugin) {
      case 'maven':
        expect(await snippetOf(page, 'settings.xml')).toContain(read);
        break;
      case 'npm':
        expect(await snippetOf(page, '.npmrc')).toContain(read);
        expect(await snippetOf(page, 'Publish with npm')).toContain(
          resolved(entry.write ?? entry.read, lab.base_path, base),
        );
        break;
      case 'python':
        expect(await snippetOf(page, 'Install with pip')).toContain(read);
        expect(await snippetOf(page, 'Upload with twine')).toContain(
          resolved(entry.write ?? entry.read, lab.base_path, base),
        );
        break;
      case 'deb': {
        const sources = await snippetOf(page, 'APT sources');
        expect(sources).toContain(`URIs: ${read}`);
        expect(sources).toContain(`Suites: ${entry.suite}`);
        expect(sources).toContain(
          `Components: ${(entry.components ?? []).join(' ')}`,
        );
        expect(sources).toContain('Signed-By:');
        expect(await snippetOf(page, 'Signing key')).toContain(
          entry.signingKey as string,
        );
        break;
      }
      case 'rpm': {
        const file = await snippetOf(page, 'Repository file');
        expect(file).toContain(read);
        expect(file).toContain(entry.signingKey as string);
        break;
      }
      default:
        throw new Error(`no check for the entry point of ${entry.plugin}`);
    }
  }
});

test('a maven distribution bound to a repository names its deploy address, and one bound to nothing shows no deploy tab', async ({
  page,
}) => {
  test.setTimeout(180_000);
  // the seeded serving distribution is bound to the repository of its name
  await openDistribution(page, 'maven', 'zz-synth-serving-maven-repo');
  // the deploy tabs wait for the read of the repository the distribution serves
  await expect(
    panel(page).getByRole('tab', { name: 'Deploy with Maven', exact: true }),
  ).toBeVisible();
  expect(await tabsOf(page)).toEqual(
    expect.arrayContaining(['Deploy with Maven', 'Deploy with Gradle']),
  );
  expect(await snippetOf(page, 'Deploy with Maven')).toContain(
    '/pulp/maven/zz-synth-serving-maven-repo/',
  );
  expect(await snippetOf(page, 'Deploy with Gradle')).toContain(
    '/pulp/maven/zz-synth-serving-maven-repo/',
  );

  const unbound = objects.name('maven-unbound');
  await objects.create(PLUGINS.maven.distributions, {
    name: unbound,
    base_path: unbound,
  });
  await openDistribution(page, 'maven', unbound);
  // the page has settled what it serves before the tabs are judged
  await expect(
    page
      .locator('[data-cy=DistributionDetail-details]')
      .getByText('Nothing', { exact: true }),
  ).toBeVisible();
  const shown = await tabsOf(page);
  expect(shown).not.toContain('Deploy with Maven');
  expect(shown).not.toContain('Deploy with Gradle');
});

test('the pip and twine lines of a scratch python distribution name addresses that work', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const repository = await objects.create(PLUGINS.python.repositories, {
    name: objects.name('py-repo'),
  });
  const name = objects.name('py-dist');
  await objects.create(PLUGINS.python.distributions, {
    name,
    base_path: name,
    repository: repository.pulp_href,
  });

  await openDistribution(page, 'python', name);
  const pip = await snippetOf(page, 'Install with pip');
  const twine = await snippetOf(page, 'Upload with twine');
  const index = /--index-url '([^']+)'/.exec(pip)?.[1] as string;
  const upload = /--repository-url '([^']+)'/.exec(twine)?.[1] as string;
  expect(index, 'the index address of the pip line').toMatch(/^https?:\/\//);
  expect(upload, 'the upload address of the twine line').toMatch(
    /^https?:\/\//,
  );
  expect(twine).toContain("--username '<user>' --password '<token>'");

  // twine: the upload address takes a package with the lab account
  const project = `${objects.prefix}pkg`;
  const generated = wheel(project);
  const sent = await objects.api.post(upload, {
    multipart: {
      ':action': 'file_upload',
      protocol_version: '1',
      metadata_version: '2.1',
      name: project,
      version: '1.0',
      filetype: 'bdist_wheel',
      sha256_digest: createHash('sha256')
        .update(new Uint8Array(generated.buffer))
        .digest('hex'),
      pyversion: 'py3',
      content: {
        name: generated.fileName,
        mimeType: 'application/octet-stream',
        buffer: generated.buffer,
      },
    },
  });
  expect(
    sent.status(),
    `upload to the address of the twine line: ${(await sent.text()).slice(0, 300)}`,
  ).toBeLessThan(300);
  await expect
    .poll(() => objects.versionNumbers(repository.pulp_href), {
      message: 'versions of the repository after the upload',
      timeout: 120_000,
    })
    .toEqual([1, 0]);
  objects.trackContent(
    await objects.versionContent(`${repository.pulp_href}versions/1/`),
  );

  // pip: the index address lists the package and the file downloads
  const simple = `${index}${project.replace(/[-_.]+/g, '-').toLowerCase()}/`;
  await expect
    .poll(
      async () =>
        (await objects.api.get(simple, { failOnStatusCode: false })).status(),
      { message: 'the simple index page of the package', timeout: 60_000 },
    )
    .toBe(200);
  const listing = await (await objects.api.get(simple)).text();
  expect(listing).toContain(generated.fileName);
});

test('the signature keys screen lists the lab services, filters by the whole name and reads no script', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const services = await objects.list('/pulp/api/v3/signing-services/', {
    fields: 'name,pubkey_fingerprint,public_key',
  });
  expect(services.length, 'signing services of the lab').toBeGreaterThan(0);

  const reads: string[] = [];
  page.on('request', (request) => {
    const { pathname, search } = new URL(request.url());
    if (pathname === '/pulp/api/v3/signing-services/') {
      reads.push(search);
    }
  });
  await page.goto('signature-keys');
  await expect(title(page, 'Signature keys')).toBeVisible();
  const table = page.locator(
    'table[aria-label="Signature keys"][data-rows-loaded="true"]',
  );
  await expect(table).toBeVisible();
  for (const service of services) {
    const row = page.locator(
      `[data-cy="SignatureKeyList-row-${String(service['name'])}"]`,
    );
    await expect(row).toContainText(String(service['name']));
    await expect(row).toContainText(String(service['pubkey_fingerprint']));
  }
  expect(reads, 'reads of the signing services').not.toHaveLength(0);
  for (const search of reads) {
    const fields = new URLSearchParams(search).getAll('fields').join(',');
    expect(fields, 'the fields the screen asks for').toContain('name');
    expect(
      fields.split(','),
      'the screen never asks for the script',
    ).not.toContain('script');
  }

  // download the key of one service
  const first = services[0] as PulpObject;
  const row = page.locator(
    `[data-cy="SignatureKeyList-row-${String(first['name'])}"]`,
  );
  await row.locator('[data-cy=kebab-toggle] button').click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download key' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(`${String(first['name'])}.asc`);

  // the server's name filter is exact: the whole name leaves that row, a part
  // of it leaves none
  const box = page.getByRole('textbox', { name: 'name' });
  await box.fill(String(first['name']));
  await box.press('Enter');
  await expect(
    page.locator('table[aria-label="Signature keys"] tbody tr'),
  ).toHaveCount(1);
  await expect(
    page.locator(`[data-cy="SignatureKeyList-row-${String(first['name'])}"]`),
  ).toBeVisible();

  await box.fill(String(first['name']).slice(0, 5));
  await box.press('Enter');
  await expect(
    page.locator('table[aria-label="Signature keys"] tbody tr'),
  ).toHaveCount(0);
});

// Reads the number a list says it holds, from the pagination beside it.
async function listedTotal(page: Page): Promise<number> {
  const text = await page.locator('.pf-v6-c-pagination').first().innerText();
  const match = /of\s+([\d,]+)/.exec(text);
  return Number((match?.[1] ?? '').replace(/,/g, ''));
}

const CONTENT_LISTS = [
  { plugin: 'rpm', api: 'content/rpm/packages/' },
  { plugin: 'file', api: 'content/file/files/' },
  { plugin: 'deb', api: 'content/deb/packages/' },
  { plugin: 'python', api: 'content/python/packages/' },
];

for (const { plugin, api } of CONTENT_LISTS) {
  test(`${plugin}: the global content list shows what the server holds, with one list request per page`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const requests = recordRequests(page);
    await page.goto(`${plugin}/content`);
    await expect(
      page.getByRole('heading', { name: /content$/i }).first(),
    ).toBeVisible();
    await expect(page.locator('table tbody tr').first()).toBeVisible({
      timeout: 60_000,
    });
    const count = (
      await apiGet<{ count: number }>(objects.api, `/pulp/api/v3/${api}`, {
        limit: '1',
      })
    ).count;
    expect(await listedTotal(page), 'matches the list says it holds').toBe(
      count,
    );
    await expect(page.locator('table tbody tr')).toHaveCount(
      Math.min(50, count),
    );

    // one read of the list for the page, none for a row, none to a repository
    const contentReads = requests.filter(
      (line) => line.startsWith('GET ') && line.includes(`/pulp/api/v3/${api}`),
    );
    expect(contentReads, 'list requests of the page').toHaveLength(1);
    expect(
      requests.filter((line) => line.includes('/pulp/api/v3/repositories/')),
      'requests to a repository',
    ).toEqual([]);
  });
}

test('the old content addresses keep their query and lead to the new lists', async ({
  page,
}) => {
  await page.goto('python/packages?name=x');
  await expect(page).toHaveURL(/\/python\/content\/?\?(.*&)?name=x/);
  await page.goto('rpm/rpms');
  await expect(page).toHaveURL(/\/rpm\/content\/?$/);
});

test('the old packages address of an rpm and a python repository leads to its Content tab', async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const plugin of ['rpm', 'python'] as const) {
    const repository = await objects.create(PLUGINS[plugin].repositories, {
      name: objects.name(`${plugin}-old`),
    });
    const name = repository['name'] as string;
    await page.goto(`${plugin}/repositories/${enc(name)}/packages?page=2`);
    await expect(page).toHaveURL(
      new RegExp(
        `/${plugin}/repositories/${enc(name)}/content\\/?\\?(.*&)?page=2`,
      ),
    );
  }
});

test('a label set on a unit is found by its selector and the list filters by name', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const repository = await objects.fileRepository('labelled', [
    'lab-a.txt',
    'lab-b.txt',
  ]);
  const units = await objects.list('/pulp/api/v3/content/file/files/', {
    repository_version: `${repository.pulp_href}versions/2/`,
    fields: 'pulp_href,relative_path',
  });
  const target = units.find(
    ({ relative_path }) => relative_path === objects.path('lab-a.txt'),
  ) as PulpObject;
  const key = `zz-e2e-${objects.prefix.split('-')[2]}`;
  await apiPost(objects.api, getContentFileFilesSetLabelUrl(target.pulp_href), {
    key,
    value: 'selected',
  });

  // by the label selector: exactly that unit of the whole server
  await page.goto(`file/content?pulp_label_select=${enc(`${key}=selected`)}`);
  await expect(page.locator('table tbody tr')).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(page.locator('table tbody tr')).toContainText(
    objects.path('lab-a.txt'),
  );
  await expect(page.locator('table tbody tr')).toContainText(
    `${key}: selected`,
  );

  // by name: both units of the run, and no other
  await page.goto(
    `file/content?relative_path__contains=${enc(objects.prefix)}`,
  );
  await expect(page.locator('table tbody tr')).toHaveCount(2, {
    timeout: 60_000,
  });
});
