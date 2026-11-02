import { type Page } from '@playwright/test';
import { apiContext } from '../support/api';

// Every list page of the application, with the plugin that has to be installed
// on the server for the page to make sense (null for pages of Pulp core) and
// the title the page shows. The paths are relative to the UI root.
//
// `knownDefect` names, per account, a failure that comes from a defect of the
// deployed application and not of the test: the test is then marked as
// expected to fail with that reason, so it still runs and the run reports it
// the day the page works. `viewerRefused` marks a page the limited account may
// not read: the server answers it with 403.

export interface ListPage {
  name: string;
  path: string;
  plugin: string | null;
  title: string;
  viewerRefused?: boolean;
  knownDefect?: { admin?: string; viewer?: string };
}

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
    knownDefect: {
      admin:
        'The page crashes into the error boundary: it builds a link without the repository name it needs.',
      viewer:
        'The page crashes into the error boundary: it builds a link without the repository name it needs.',
    },
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
    knownDefect: {
      admin:
        'The page crashes into the error boundary: it reads the namespace of a collection that the server does not return.',
    },
  },
  {
    name: 'Ansible namespaces',
    path: 'ansible/namespaces',
    plugin: 'ansible',
    title: 'Namespaces',
    knownDefect: {
      admin:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
      viewer:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
    },
  },
  {
    name: 'Ansible my namespaces',
    path: 'ansible/my-namespaces',
    plugin: 'ansible',
    title: 'Namespaces',
    knownDefect: {
      admin:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
      viewer:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
    },
  },
  {
    name: 'Ansible approvals',
    path: 'ansible/approvals',
    plugin: 'ansible',
    title: 'Approvals',
    knownDefect: {
      admin:
        'The page is an empty under-construction placeholder with no title.',
      viewer:
        'The page is an empty under-construction placeholder with no title.',
    },
  },
  {
    name: 'Ansible imports',
    path: 'ansible/my-imports',
    plugin: 'ansible',
    title: 'Imports',
    knownDefect: {
      admin:
        'The page loads namespaces from an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
      viewer:
        'The page loads namespaces from an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
    },
  },
  {
    name: 'Container repositories',
    path: 'container/containers',
    plugin: 'container',
    title: 'Containers',
  },
  {
    name: 'Container remote registries',
    path: 'container/remotes',
    plugin: 'container',
    title: 'Remote registries',
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
// worker.
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
  })();
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

// Skip reason for a page whose plugin the server does not run, or null. The
// pages of an expected plugin are skipped only when the run allows it; every
// other plugin (container) is optional.
export async function missingPlugin(entry: ListPage): Promise<string | null> {
  if (!entry.plugin) {
    return null;
  }
  if (EXPECTED_PLUGINS.includes(entry.plugin) && !missingPluginsAllowed()) {
    return null;
  }
  return (await installedPlugins()).has(entry.plugin)
    ? null
    : `the ${entry.plugin} plugin is not installed on this server`;
}

// What a page did while it loaded: uncaught errors, and the answers of the
// API that were errors.
export interface PageWatch {
  errors: string[];
  failed: { url: string; status: number }[];
}

export function watchPage(page: Page): PageWatch {
  const watch: PageWatch = { errors: [], failed: [] };
  page.on('pageerror', (error) => watch.errors.push(error.message));
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
