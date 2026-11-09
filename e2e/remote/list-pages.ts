import { type Page, expect } from '@playwright/test';
import { apiContext } from '../support/api';
import { title } from '../support/sign-in';

// Every list page of the application, with the plugin that has to be installed
// on the server for the page to make sense (null for pages of Pulp core) and
// the title the page shows. The paths are relative to the UI root.
//
// `knownDefect` names, per account, a failure that comes from a defect of the
// deployed application and not of the test: the test is then marked as
// expected to fail with that reason, so it still runs and the run reports it
// the day the page works. `viewerRefused` marks a page the limited account may
// not read: the server answers it with 403.
//
// `outcome` names a page that is deliberately not a working screen: a
// placeholder that says the screen is not available yet, or the not-found page
// of a route that no longer exists. Such a page must show exactly that, with no
// failed request and no request to an endpoint that only galaxy_ng serves.
// For these entries `title` is the heading the page shows.

export type Outcome = 'placeholder' | 'not-found';

export interface ListPage {
  name: string;
  path: string;
  plugin: string | null;
  title: string;
  outcome?: Outcome;
  viewerRefused?: boolean;
  knownDefect?: { admin?: string; viewer?: string };
}

const NOT_FOUND_TITLE = '404 - Page not found';

export const listPages: ListPage[] = [
  { name: 'Status', path: 'status', plugin: null, title: 'Status' },
  {
    name: 'Task management',
    path: 'tasks',
    plugin: null,
    title: 'Task management',
  },
  { name: 'Groups', path: 'groups', plugin: null, title: 'Groups' },
  {
    name: 'Roles',
    path: 'roles',
    plugin: null,
    title: 'Roles',
    viewerRefused: true,
  },
  {
    name: 'Users',
    path: 'users',
    plugin: null,
    title: 'Users',
    viewerRefused: true,
  },
  {
    name: 'Signature keys',
    path: 'signature-keys',
    plugin: null,
    title: 'Signature keys',
    viewerRefused: true,
  },
  {
    name: 'About project',
    path: 'about',
    plugin: null,
    title: 'About project',
  },
  {
    name: 'Search',
    path: 'search',
    plugin: null,
    title: 'Search',
    outcome: 'placeholder',
  },
  {
    name: 'Ansible repositories',
    path: 'ansible/repositories',
    plugin: 'ansible',
    title: 'Repositories',
  },
  {
    name: 'Ansible remotes',
    path: 'ansible/remotes',
    plugin: 'ansible',
    title: 'Remotes',
  },
  {
    name: 'Ansible collections',
    path: 'ansible/collections',
    plugin: 'ansible',
    title: 'Collections',
    outcome: 'placeholder',
  },
  {
    name: 'Ansible namespaces',
    path: 'ansible/namespaces',
    plugin: 'ansible',
    title: 'Namespaces',
    outcome: 'placeholder',
  },
  {
    name: 'Ansible my namespaces',
    path: 'ansible/my-namespaces',
    plugin: 'ansible',
    title: NOT_FOUND_TITLE,
    outcome: 'not-found',
  },
  {
    name: 'Ansible approvals',
    path: 'ansible/approvals',
    plugin: 'ansible',
    title: NOT_FOUND_TITLE,
    outcome: 'not-found',
  },
  {
    name: 'Ansible imports',
    path: 'ansible/my-imports',
    plugin: 'ansible',
    title: NOT_FOUND_TITLE,
    outcome: 'not-found',
  },
  {
    name: 'Container repositories',
    path: 'container/containers',
    plugin: 'container',
    title: 'Containers',
    outcome: 'placeholder',
  },
  {
    name: 'Container remote registries',
    path: 'container/remotes',
    plugin: 'container',
    title: 'Remote registries',
    outcome: 'placeholder',
  },
  {
    name: 'Deb repositories',
    path: 'deb/repositories',
    plugin: 'deb',
    title: 'Repositories',
  },
  { name: 'Deb remotes', path: 'deb/remotes', plugin: 'deb', title: 'Remotes' },
  {
    name: 'File repositories',
    path: 'file/repositories',
    plugin: 'file',
    title: 'Repositories',
  },
  {
    name: 'File remotes',
    path: 'file/remotes',
    plugin: 'file',
    title: 'Remotes',
  },
  {
    name: 'Python repositories',
    path: 'python/repositories',
    plugin: 'python',
    title: 'Repositories',
  },
  {
    name: 'Python remotes',
    path: 'python/remotes',
    plugin: 'python',
    title: 'Remotes',
  },
  {
    name: 'Python packages',
    path: 'python/packages',
    plugin: 'python',
    title: 'Packages',
  },
  {
    name: 'RPM repositories',
    path: 'rpm/repositories',
    plugin: 'rpm',
    title: 'Repositories',
  },
  { name: 'RPM remotes', path: 'rpm/remotes', plugin: 'rpm', title: 'Remotes' },
  { name: 'RPM packages', path: 'rpm/rpms', plugin: 'rpm', title: 'Packages' },
];

// The components the server reports in status/ versions, read once per
// worker. A failed read is not kept, so the next test asks again instead of
// failing with the same error.
let installed: Promise<Set<string>> | undefined;

export function installedPlugins(): Promise<Set<string>> {
  installed ??= (async () => {
    const api = await apiContext();
    try {
      const response = await api.get('/pulp/api/v3/status/');
      const { versions } = (await response.json()) as {
        versions: { component: string }[];
      };
      return new Set(versions.map(({ component }) => component));
    } finally {
      await api.dispose();
    }
  })().catch((error) => {
    installed = undefined;
    throw error;
  });
  return installed;
}

// The plugins a deployment of this application is expected to run. A server
// without one of them is a broken deployment, not a reason to skip its pages.
export const EXPECTED_PLUGINS = ['file', 'deb', 'rpm', 'python', 'ansible'];

// Lets a run on a deployment with fewer plugins skip their pages instead of
// failing; unset, a missing expected plugin fails the run.
export const ALLOW_MISSING_PLUGINS_VARIABLE =
  'PULP_UI_E2E_ALLOW_MISSING_PLUGINS';

export function missingPluginsAllowed(): boolean {
  return !!process.env[ALLOW_MISSING_PLUGINS_VARIABLE];
}

// The expected plugins the server does not report.
export async function missingExpectedPlugins(): Promise<string[]> {
  const present = await installedPlugins();
  return EXPECTED_PLUGINS.filter((plugin) => !present.has(plugin));
}

// Skip reason for a page whose plugin the server does not run, or null. Only
// the pages of an expected plugin are skipped, and only when the run allows
// it. A page of an optional plugin (container) is never skipped: the
// application says the plugin is not installed, and absentOptionalPlugin names
// that case.
export async function missingPlugin(entry: ListPage): Promise<string | null> {
  if (
    !entry.plugin ||
    !EXPECTED_PLUGINS.includes(entry.plugin) ||
    !missingPluginsAllowed()
  ) {
    return null;
  }
  return (await installedPlugins()).has(entry.plugin)
    ? null
    : `the ${entry.plugin} plugin is not installed on this server`;
}

// The plugin of a page when that plugin is optional and the server does not
// report it, otherwise null. The page then shows the not-installed page in
// place of its screen.
export async function absentOptionalPlugin(
  entry: ListPage,
): Promise<string | null> {
  if (!entry.plugin || EXPECTED_PLUGINS.includes(entry.plugin)) {
    return null;
  }
  return (await installedPlugins()).has(entry.plugin) ? null : entry.plugin;
}

// What a page did while it loaded: uncaught errors, the paths of the API
// requests it sent, and the answers of the API that were errors.
export interface PageWatch {
  errors: string[];
  requests: string[];
  failed: { url: string; status: number }[];
}

export function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { errors: [], requests: [], failed: [] };
  page.on('pageerror', (error) => watch.errors.push(error.message));
  page.on('request', (request) => {
    const { pathname } = new URL(request.url());
    if (pathname.startsWith('/pulp/api/')) {
      watch.requests.push(pathname);
    }
  });
  page.on('response', (response) => {
    const { pathname } = new URL(response.url());
    if (pathname.startsWith('/pulp/api/') && response.status() >= 400) {
      watch.failed.push({ url: pathname, status: response.status() });
    }
  });
  return watch;
}

// The ways a list page says that loading failed: an error alert, or the error
// state with its Retry button.
export function failureShown(page: Page) {
  return page
    .locator('.pf-v5-c-alert.pf-m-danger')
    .or(page.getByRole('button', { name: 'Retry', exact: true }));
}

// A request path that only a galaxy_ng server answers: its internal UI API,
// or its collection API, which is a second v3/ below the API root.
export function galaxyOnly(pathname: string): boolean {
  return /\/_ui\//.test(pathname) || pathname.startsWith('/pulp/api/v3/v3/');
}

// The page of an entry is on screen: the not-installed page when the plugin
// is optional and absent, otherwise the entry's title, and for a placeholder
// its sentence.
export async function expectPageShown(
  page: Page,
  entry: ListPage,
  notInstalled: string | null,
): Promise<void> {
  if (notInstalled) {
    await expect(title(page, 'Plugin not installed')).toBeVisible();
    await expect(
      page.getByText(
        `The ${notInstalled} plugin is not installed on this Pulp server.`,
      ),
    ).toBeVisible();
    return;
  }
  await expect(title(page, entry.title)).toBeVisible();
  if (entry.outcome === 'placeholder') {
    await expect(
      page.getByText('This screen is not available in this UI yet.'),
    ).toBeVisible();
  }
}

// A placeholder, a not-found page and a not-installed page load nothing of
// their own: no failed answer, and no request to a galaxy-only endpoint.
export function expectNothingLoaded(
  watch: PageWatch,
  entry: ListPage,
  notInstalled: string | null,
): void {
  if (!entry.outcome && !notInstalled) {
    return;
  }
  expect(watch.failed, 'API requests of the page that failed').toEqual([]);
  expect(
    watch.requests.filter(galaxyOnly),
    'requests of the page to endpoints only galaxy_ng serves',
  ).toEqual([]);
}
