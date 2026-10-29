import { apiContext } from '../support/api';

// Every list page of the application, with the plugin that has to be installed
// on the server for the page to make sense (null for pages of Pulp core) and
// the title the page shows. The paths are relative to the UI root. A page whose
// plugin is not installed is skipped with the plugin named.
//
// `fixme` names, per account, a failure that comes from a defect of the
// deployed application and not of the test: the test is then marked fixme with
// that reason instead of being hidden or deleted.

export interface ListPage {
  name: string;
  path: string;
  plugin: string | null;
  title: string;
  fixme?: { admin?: string; viewer?: string };
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
  { name: 'Roles', path: 'roles', plugin: null, title: 'Roles' },
  { name: 'Users', path: 'users', plugin: null, title: 'Users' },
  {
    name: 'Signature keys',
    path: 'signature-keys',
    plugin: null,
    title: 'Signature keys',
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
    fixme: {
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
    fixme: {
      admin:
        'The page crashes into the error boundary: it reads the namespace of a collection that the server does not return.',
    },
  },
  {
    name: 'Ansible namespaces',
    path: 'ansible/namespaces',
    plugin: 'ansible',
    title: 'Namespaces',
    fixme: {
      admin:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
    },
  },
  {
    name: 'Ansible my namespaces',
    path: 'ansible/my-namespaces',
    plugin: 'ansible',
    title: 'Namespaces',
    fixme: {
      admin:
        'The list cannot be loaded: it calls an endpoint that exists only on galaxy_ng and shows a 404 error alert.',
    },
  },
  {
    name: 'Ansible approvals',
    path: 'ansible/approvals',
    plugin: 'ansible',
    title: 'Approvals',
    fixme: {
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
    fixme: {
      admin:
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

// Skip reason for a page whose plugin the server does not run, or null.
export async function missingPlugin(entry: ListPage): Promise<string | null> {
  if (!entry.plugin) {
    return null;
  }
  return (await installedPlugins()).has(entry.plugin)
    ? null
    : `the ${entry.plugin} plugin is not installed on this server`;
}
