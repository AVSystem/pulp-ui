import { type Page, expect, test } from '@playwright/test';
import { account } from '../support/accounts';
import { TestObjects } from '../support/api';
import { apiGet } from '../support/sdk-request';
import { isPermissionsRead } from '../support/session';
import { title } from '../support/sign-in';
import { type ListPage, missingPlugin } from './list-pages';
import { signedOut } from './session-helpers';

// What the limited account is shown of the administration screens, and what a
// visitor who is not signed in is shown at all. These are presentation rules:
// Pulp decides who may read what, and the screens only stop offering what the
// server would refuse.

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main' });

// The administration screens by address: the lists and the forms that create.
const ADMINISTRATION = [
  'users',
  'groups',
  'roles',
  'users/create',
  'roles/create',
];

// The repository and remote forms of each plugin, by the REST endpoint that
// lists their objects.
const FORMS = [
  { plugin: 'file', repositories: 'file/file', remotes: 'file/file' },
  { plugin: 'deb', repositories: 'deb/apt', remotes: 'deb/apt' },
  { plugin: 'rpm', repositories: 'rpm/rpm', remotes: 'rpm/rpm' },
  { plugin: 'python', repositories: 'python/python', remotes: 'python/python' },
  {
    plugin: 'ansible',
    repositories: 'ansible/ansible',
    remotes: 'ansible/collection',
  },
] as const;

// What creating a remote of a kind needs besides its name. The address is
// reserved for examples and is never contacted.
const REMOTE_BODY: Record<string, Record<string, unknown>> = {
  'file/file': { url: 'https://pulp.example/zz-e2e/PULP_MANIFEST' },
  'deb/apt': { url: 'https://pulp.example/zz-e2e/', distributions: 'stable' },
  'rpm/rpm': { url: 'https://pulp.example/zz-e2e/' },
  'python/python': { url: 'https://pulp.example/zz-e2e/' },
  'ansible/collection': { url: 'https://pulp.example/zz-e2e/' },
};

// What a form address of an existing object shows the limited account. An
// object the account may read has a form it may not save: the insufficient
// permissions page. An object it cannot see is absent for it: the not found
// page, never a form of a new object. Either way nothing saves and no request
// writes.
async function expectRefusedForm(
  page: Page,
  path: string,
  outcome: 'refused' | 'absent' = 'refused',
): Promise<void> {
  const writes: string[] = [];
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (
      pathname.startsWith('/pulp/api/') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      writes.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto(path);
  if (outcome === 'refused') {
    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await expect(
      page.getByText('You do not have permission to view this page.'),
    ).toBeVisible();
  } else {
    await expect(title(page, 'Page not found')).toBeVisible();
    await expect(title(page, 'Insufficient permissions')).toHaveCount(0);
  }
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0);
  await expect(page.getByText('The stack trace is:')).toHaveCount(0);
  expect(writes, 'requests of the page that write').toEqual([]);
}

test.describe('the limited account', () => {
  test('has no Users, Groups or Roles entry in the sidebar', async ({
    page,
  }) => {
    await page.goto('status');
    await expect(title(page, 'Status')).toBeVisible();
    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-status]'),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    for (const id of ['users', 'groups', 'roles']) {
      await expect(
        sidebar(page).locator(`[data-cy=pulp-menu-item-${id}]`),
      ).toHaveCount(0);
    }
    await expect(
      sidebar(page).getByRole('link', { name: /^(Users|Groups|Roles)$/ }),
    ).toHaveCount(0);
  });

  for (const path of ADMINISTRATION) {
    test(`${path} opened by address shows the insufficient permissions page`, async ({
      page,
    }) => {
      await page.goto(path);

      await expect(title(page, 'Insufficient permissions')).toBeVisible();
      await expect(
        page.getByText('You do not have permission to view this page.'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
      await expect(page.getByText('The stack trace is:')).toHaveCount(0);
    });
  }

  test('the task list offers none of the task actions', async ({ page }) => {
    const permissionsRead = page.waitForResponse(isPermissionsRead);
    await page.goto('tasks');
    await permissionsRead;
    await expect(title(page, 'Task management')).toBeVisible();
    await page.waitForLoadState('networkidle');

    const actions = /Orphan cleanup|Repair|Purge tasks|Stop task/;
    await expect(page.getByRole('button', { name: actions })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: actions })).toHaveCount(0);
    await expect(page.locator('[data-cy=kebab-toggle]')).toHaveCount(0);
  });

  test('has no Signing services entry in the sidebar and is refused its address', async ({
    page,
  }) => {
    await page.goto('signature-keys');
    await expect(title(page, 'Insufficient permissions')).toBeVisible();
    await page.waitForLoadState('networkidle');

    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-status]'),
    ).toBeVisible();
    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-signing-services]'),
    ).toHaveCount(0);
    await expect(
      sidebar(page).getByRole('link', { name: 'Signing services' }),
    ).toHaveCount(0);
  });

  test('sees the Versions card and the administrators note on the Status screen and no online workers', async ({
    page,
  }) => {
    await page.goto('status');
    await expect(title(page, 'Status')).toBeVisible();
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Versions', { exact: true })).toBeVisible();
    await expect(
      page.getByText(
        'Workers, storage and content settings are shown to administrators.',
      ),
    ).toBeVisible();
    await expect(page.getByText('Online workers')).toHaveCount(0);
  });

  test('sees the versions of the installed plugins on the Status screen and no workers, storage or content settings', async ({
    page,
  }) => {
    await page.goto('status');
    await expect(title(page, 'Status')).toBeVisible();
    await page.waitForLoadState('networkidle');

    // each plugin shows with its version in the Versions card
    const main = page.getByRole('main');
    await expect(main.getByText('Versions', { exact: true })).toBeVisible();
    await expect(main.getByText(/^core$/)).toBeVisible();

    for (const card of ['Online workers', 'Storage', 'Content settings']) {
      await expect(main.getByText(card, { exact: true }), card).toHaveCount(0);
    }
  });

  test('opens its own profile and sees it', async ({ page }) => {
    await page.goto('users/profile');

    await expect(title(page, 'My profile')).toBeVisible();
    // the profile shows the account's own record, read-only, with its user name
    await expect(
      page.getByRole('main').getByText(account('viewer').username),
    ).toBeVisible();
    await expect(title(page, 'Insufficient permissions')).toHaveCount(0);
    // the profile of an account that may not change users offers no Edit,
    // checked once the requests of the page have settled
    await page.waitForLoadState('networkidle');
    await expect(
      page.getByRole('button', { name: 'Edit', exact: true }),
    ).toHaveCount(0);
  });
});

// The edit and add pages of every repository and remote form, opened by
// address. An existing object of each kind is used when the server holds one;
// otherwise a test object is created with the administrator and removed again.
test.describe('the forms of repositories and remotes opened by address', () => {
  let objects: TestObjects;
  const names = new Map<string, Promise<string>>();

  // Each worker has objects of its own, so one worker's clean-up never removes
  // what another worker is using.
  test.beforeAll(async () => {
    objects = await TestObjects.open(`access-forms-${test.info().workerIndex}`);
  });

  test.afterAll(async () => {
    test.setTimeout(180_000);
    await objects.cleanUp();
  });

  function objectName(kind: 'repositories' | 'remotes', endpoint: string) {
    const key = `${kind}/${endpoint}`;
    let found = names.get(key);
    if (!found) {
      found = (async () => {
        const { results } = await apiGet<{ results: { name: string }[] }>(
          objects.api,
          `/pulp/api/v3/${key}/`,
          { limit: '1', fields: 'name' },
        );
        if (results[0]) {
          return results[0].name;
        }
        const created = await objects.create(`${key}/`, {
          name: objects.name(key.replace(/\//g, '-')),
          ...(kind === 'remotes' ? REMOTE_BODY[endpoint] : {}),
        });
        return created.name as string;
      })();
      names.set(key, found);
    }
    return found;
  }

  for (const { plugin, repositories, remotes } of FORMS) {
    const entry = { plugin } as ListPage;
    for (const [kind, endpoint] of [
      ['repositories', repositories],
      ['remotes', remotes],
    ] as const) {
      const base = `${plugin}/${kind}`;

      test(`the ${plugin} ${kind} edit page of an existing object is refused: the permissions page for one the account can read, not found for one it cannot see`, async ({
        page,
      }) => {
        const absent = await missingPlugin(entry);
        test.skip(absent !== null, absent ?? '');
        const name = await objectName(kind, endpoint);

        // what the account itself can list decides which of the two it is
        const visible = await apiGet<{ count: number }>(
          page.request,
          `/pulp/api/v3/${kind}/${endpoint}/`,
          { name, limit: '1', fields: 'name' },
        );
        await expectRefusedForm(
          page,
          `${base}/edit/${encodeURIComponent(name)}`,
          visible.count > 0 ? 'refused' : 'absent',
        );
      });

      test(`the ${plugin} ${kind} add page shows the insufficient permissions page`, async ({
        page,
      }) => {
        const absent = await missingPlugin(entry);
        test.skip(absent !== null, absent ?? '');

        await expectRefusedForm(page, `${base}/edit/_`);
      });
    }
  }
});

test.describe('a visitor who is not signed in', () => {
  test.use({ storageState: signedOut });

  test('sees only Login in the sidebar and the Status screen without versions', async ({
    page,
  }) => {
    await page.goto('status');

    await expect(title(page, 'Status')).toBeVisible();
    await expect(
      page.getByText(
        'Versions, workers and storage are shown to signed-in users.',
      ),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');

    const links = sidebar(page).getByRole('link');
    await expect(links).toHaveCount(1);
    await expect(
      sidebar(page).locator('[data-cy=pulp-menu-item-login]'),
    ).toBeVisible();
    await expect(page.getByText('Versions', { exact: true })).toHaveCount(0);
  });
});
