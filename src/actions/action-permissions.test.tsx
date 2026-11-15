import { render, screen, within } from '@testing-library/react';
import { type ComponentType, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { listOf, repository, repositoryVersion } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { RepositoryVersionsTab as AnsibleTab } from '../containers/ansible-repository/tab-repository-versions';
import { RepositoryVersionsTab as DebTab } from '../containers/deb-repository/tab-repository-versions';
import { RepositoryVersionsTab as FileTab } from '../containers/file-repository/tab-repository-versions';
import { RepositoryVersionsTab as PythonTab } from '../containers/python-repository/tab-repository-versions';
import { RepositoryVersionsTab as RpmTab } from '../containers/rpm-repository/tab-repository-versions';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { type ActionType } from './action';
import { ansibleRemoteCreateAction } from './ansible-remote-create';
import { ansibleRemoteDeleteAction } from './ansible-remote-delete';
import { ansibleRemoteEditAction } from './ansible-remote-edit';
import { ansibleRepositoryCollectionVersionAddAction } from './ansible-repository-collection-version-add';
import { ansibleRepositoryCollectionVersionRemoveAction } from './ansible-repository-collection-version-remove';
import { ansibleRepositoryCopyAction } from './ansible-repository-copy';
import { ansibleRepositoryCreateAction } from './ansible-repository-create';
import { ansibleRepositoryDeleteAction } from './ansible-repository-delete';
import { ansibleRepositoryEditAction } from './ansible-repository-edit';
import { ansibleRepositorySyncAction } from './ansible-repository-sync';
import { debRemoteCreateAction } from './deb-remote-create';
import { debRemoteDeleteAction } from './deb-remote-delete';
import { debRemoteEditAction } from './deb-remote-edit';
import { debRepositoryCreateAction } from './deb-repository-create';
import { debRepositoryDeleteAction } from './deb-repository-delete';
import { debRepositoryEditAction } from './deb-repository-edit';
import { debRepositorySyncAction } from './deb-repository-sync';
import { fileRemoteCreateAction } from './file-remote-create';
import { fileRemoteDeleteAction } from './file-remote-delete';
import { fileRemoteEditAction } from './file-remote-edit';
import { fileRepositoryCreateAction } from './file-repository-create';
import { fileRepositoryDeleteAction } from './file-repository-delete';
import { fileRepositoryEditAction } from './file-repository-edit';
import { fileRepositorySyncAction } from './file-repository-sync';
import { pythonDistributionEditAction } from './python-distribution-edit';
import { pythonRemoteCreateAction } from './python-remote-create';
import { pythonRemoteDeleteAction } from './python-remote-delete';
import { pythonRemoteEditAction } from './python-remote-edit';
import { pythonRepositoryCreateAction } from './python-repository-create';
import { pythonRepositoryDeleteAction } from './python-repository-delete';
import { pythonRepositoryEditAction } from './python-repository-edit';
import { pythonRepositorySyncAction } from './python-repository-sync';
import { repositoryVersionRevertAction } from './repository-version-revert';
import { rpmRemoteCreateAction } from './rpm-remote-create';
import { rpmRemoteDeleteAction } from './rpm-remote-delete';
import { rpmRemoteEditAction } from './rpm-remote-edit';
import { rpmRepositoryCreateAction } from './rpm-repository-create';
import { rpmRepositoryDeleteAction } from './rpm-repository-delete';
import { rpmRepositoryEditAction } from './rpm-repository-edit';
import { rpmRepositorySyncAction } from './rpm-repository-sync';

const API = '/pulp/api/v3';

// A context in which the user holds the named permissions globally and, per
// object address, the permissions of that object (as the pages answer it).
const context = ({
  global = [],
  object = {},
}: {
  global?: string[];
  object?: Record<string, string[]>;
} = {}) => {
  const hasPermission = vi.fn((name: string) => global.includes(name));
  const hasObjectPermission = vi.fn(
    (name: string, item?: { pulp_href?: string }) =>
      global.includes(name) || !!object[item?.pulp_href ?? '']?.includes(name),
  );
  return { hasPermission, hasObjectPermission };
};

interface Row {
  label: string;
  action: ActionType;
  permission: string;
  // false: only a permission held on every object counts
  objectLevel: boolean;
  item: Record<string, unknown>;
  // an object of the plugin whose permissions may list the permission
  listed: Record<string, unknown>;
  // a permission of the same plugin that must not stand in for it
  lookalike?: string;
  plugin: string;
}

// The rows of one plugin: its seven repository and remote actions, each with
// the permission its viewset checks and an item at the plugin's addresses.
// `names` are the model names the permissions are built from.
interface PluginActions {
  repositoryCreate: ActionType;
  repositoryEdit: ActionType;
  repositorySync: ActionType;
  repositoryDelete: ActionType;
  remoteCreate: ActionType;
  remoteEdit: ActionType;
  remoteDelete: ActionType;
}

const rowsOf = (
  plugin: string,
  names: { repository: string; remote: string },
  paths: { repository: string; remote: string },
  actions: PluginActions,
): Row[] => {
  const remoteHref = `${API}/remotes/${paths.remote}/00000000-0000-4000-8000-0000000000b1/`;
  const repositoryItem = {
    name: 'zz-test-repo',
    pulp_href: `${API}/repositories/${paths.repository}/00000000-0000-4000-8000-0000000000a1/`,
    remote: remoteHref,
  };
  const remoteItem = { name: 'zz-test-remote', pulp_href: remoteHref };
  const repo = (verb: string) => `${plugin}.${verb}_${names.repository}`;
  const remote = (verb: string) => `${plugin}.${verb}_${names.remote}`;

  return [
    {
      label: `${plugin} repository create`,
      action: actions.repositoryCreate,
      permission: repo('add'),
      objectLevel: false,
      item: null,
      listed: repositoryItem,
      plugin,
    },
    {
      label: `${plugin} repository edit`,
      action: actions.repositoryEdit,
      permission: repo('change'),
      objectLevel: true,
      item: repositoryItem,
      listed: repositoryItem,
      plugin,
    },
    {
      label: `${plugin} repository sync`,
      action: actions.repositorySync,
      permission: repo('sync'),
      lookalike: repo('change'),
      objectLevel: true,
      item: repositoryItem,
      listed: repositoryItem,
      plugin,
    },
    {
      label: `${plugin} repository delete`,
      action: actions.repositoryDelete,
      permission: repo('delete'),
      objectLevel: true,
      item: repositoryItem,
      listed: repositoryItem,
      plugin,
    },
    {
      label: `${plugin} remote create`,
      action: actions.remoteCreate,
      permission: remote('add'),
      objectLevel: false,
      item: null,
      listed: remoteItem,
      plugin,
    },
    {
      label: `${plugin} remote edit`,
      action: actions.remoteEdit,
      permission: remote('change'),
      objectLevel: true,
      item: remoteItem,
      listed: remoteItem,
      plugin,
    },
    {
      label: `${plugin} remote delete`,
      action: actions.remoteDelete,
      permission: remote('delete'),
      objectLevel: true,
      item: remoteItem,
      listed: remoteItem,
      plugin,
    },
  ];
};

const distributionItem = {
  name: 'zz-test-distribution',
  pulp_href: `${API}/distributions/python/pypi/00000000-0000-4000-8000-0000000000e1/`,
};

const collectionVersionItem = {
  namespace: 'zz',
  name: 'collection',
  version: '1.0.0',
  pulp_href: `${API}/content/ansible/collection_versions/00000000-0000-4000-8000-0000000000f1/`,
};

const ROWS: Row[] = [
  ...rowsOf(
    'file',
    { repository: 'filerepository', remote: 'fileremote' },
    { repository: 'file/file', remote: 'file/file' },
    {
      repositoryCreate: fileRepositoryCreateAction,
      repositoryEdit: fileRepositoryEditAction,
      repositorySync: fileRepositorySyncAction,
      repositoryDelete: fileRepositoryDeleteAction,
      remoteCreate: fileRemoteCreateAction,
      remoteEdit: fileRemoteEditAction,
      remoteDelete: fileRemoteDeleteAction,
    },
  ),
  ...rowsOf(
    'deb',
    { repository: 'aptrepository', remote: 'aptremote' },
    { repository: 'deb/apt', remote: 'deb/apt' },
    {
      repositoryCreate: debRepositoryCreateAction,
      repositoryEdit: debRepositoryEditAction,
      repositorySync: debRepositorySyncAction,
      repositoryDelete: debRepositoryDeleteAction,
      remoteCreate: debRemoteCreateAction,
      remoteEdit: debRemoteEditAction,
      remoteDelete: debRemoteDeleteAction,
    },
  ),
  ...rowsOf(
    'rpm',
    { repository: 'rpmrepository', remote: 'rpmremote' },
    { repository: 'rpm/rpm', remote: 'rpm/rpm' },
    {
      repositoryCreate: rpmRepositoryCreateAction,
      repositoryEdit: rpmRepositoryEditAction,
      repositorySync: rpmRepositorySyncAction,
      repositoryDelete: rpmRepositoryDeleteAction,
      remoteCreate: rpmRemoteCreateAction,
      remoteEdit: rpmRemoteEditAction,
      remoteDelete: rpmRemoteDeleteAction,
    },
  ),
  ...rowsOf(
    'python',
    { repository: 'pythonrepository', remote: 'pythonremote' },
    { repository: 'python/python', remote: 'python/python' },
    {
      repositoryCreate: pythonRepositoryCreateAction,
      repositoryEdit: pythonRepositoryEditAction,
      repositorySync: pythonRepositorySyncAction,
      repositoryDelete: pythonRepositoryDeleteAction,
      remoteCreate: pythonRemoteCreateAction,
      remoteEdit: pythonRemoteEditAction,
      remoteDelete: pythonRemoteDeleteAction,
    },
  ),
  ...rowsOf(
    'ansible',
    { repository: 'ansiblerepository', remote: 'collectionremote' },
    { repository: 'ansible/ansible', remote: 'ansible/collection' },
    {
      repositoryCreate: ansibleRepositoryCreateAction,
      repositoryEdit: ansibleRepositoryEditAction,
      repositorySync: ansibleRepositorySyncAction,
      repositoryDelete: ansibleRepositoryDeleteAction,
      remoteCreate: ansibleRemoteCreateAction,
      remoteEdit: ansibleRemoteEditAction,
      remoteDelete: ansibleRemoteDeleteAction,
    },
  ),
  // Removing a collection version modifies the content of the repository the
  // page shows; the row is a collection version, not the permission bearer.
  {
    label: 'ansible collection version remove',
    action: ansibleRepositoryCollectionVersionRemoveAction,
    permission: 'ansible.modify_ansible_repo_content',
    objectLevel: true,
    item: collectionVersionItem,
    listed: collectionVersionItem,
    plugin: 'ansible',
  },
  // The distributions of a repository page are not read for their own
  // permission lists, so only a permission held on every object counts.
  {
    label: 'python distribution edit',
    action: pythonDistributionEditAction,
    permission: 'python.change_pythondistribution',
    objectLevel: false,
    item: distributionItem,
    listed: distributionItem,
    plugin: 'python',
  },
];

const shown = (node: ReactNode) => {
  render(<>{node}</>);
  return screen.queryByRole('button', { name: /./ });
};

describe.each(ROWS)('the $label action', (row) => {
  const { action, permission, item, listed, plugin } = row;

  it('declares its permission and whether objects can grant it', () => {
    expect(action.permission).toBe(permission);
    expect(action.objectLevel).toBe(row.objectLevel);
  });

  it('is absent, not disabled, for a viewer', () => {
    const view = `${plugin}.view_repository`;
    const ctx = context({
      global: [view],
      object: { [listed.pulp_href as string]: [view] },
    });

    expect(action.isShown(item, ctx)).toBe(false);
    expect(action.button(item, ctx)).toBeNull();
    expect(action.dropdownItem(item, ctx)).toBeNull();
  });

  it('is shown to a holder of the permission on every object', () => {
    const ctx = context({ global: [permission] });

    expect(action.isShown(item, ctx)).toBe(true);
    expect(action.dropdownItem(item, ctx)).not.toBeNull();
    expect(shown(action.button(item, ctx))).toBeInTheDocument();
  });

  if (row.lookalike) {
    it('does not accept a neighbouring permission of the plugin', () => {
      const ctx = context({
        global: [row.lookalike],
        object: { [listed.pulp_href as string]: [row.lookalike] },
      });

      expect(action.isShown(item, ctx)).toBe(false);
    });
  }

  if (row.objectLevel) {
    it('is shown on the object whose permissions list it, and on no other', () => {
      const ctx = context({
        object: { [item.pulp_href as string]: [permission] },
      });

      expect(action.isShown(item, ctx)).toBe(true);
      expect(
        action.isShown({ ...item, pulp_href: `${item.pulp_href}other/` }, ctx),
      ).toBe(false);
    });
  } else {
    it('is decided by the permission held on every object alone', () => {
      const ctx = context({
        object: { [listed.pulp_href as string]: [permission] },
      });

      expect(action.isShown(item, ctx)).toBe(false);
      expect(action.isShown(listed, ctx)).toBe(false);
      expect(ctx.hasObjectPermission).not.toHaveBeenCalled();
    });
  }
});

describe.each([
  ['file', 'file', 'file.modify_filerepository', 'file.change_filerepository'],
  [
    'deb',
    'apt',
    'deb.modify_content_aptrepository',
    'deb.change_aptrepository',
  ],
  [
    'rpm',
    'rpm',
    'rpm.modify_content_rpmrepository',
    'rpm.change_rpmrepository',
  ],
  [
    'python',
    'python',
    'python.modify_pythonrepository',
    'python.change_pythonrepository',
  ],
  [
    'ansible',
    'ansible',
    'ansible.modify_ansible_repo_content',
    'ansible.change_ansiblerepository',
  ],
])('the revert action of a %s version row', (plugin, path, modify, change) => {
  const revert = repositoryVersionRevertAction({
    revert: () => Promise.reject(new Error('not used')),
  });
  const version = {
    pulp_href: `${API}/repositories/${plugin}/${path}/00000000-0000-4000-8000-0000000000a1/versions/2/`,
    number: 2,
    isLatest: false,
    repositoryName: 'zz-test-repo',
  };

  it('is absent for a user without the modify permission', () => {
    const ctx = context({ object: {} });

    expect(revert.isShown(version, ctx)).toBe(false);
    expect(revert.button(version, ctx)).toBeNull();
    expect(revert.dropdownItem(version, ctx)).toBeNull();
  });

  it('is shown to a holder of the modify permission on every object', () => {
    const ctx = context({ global: [modify] });

    expect(revert.isShown(version, ctx)).toBe(true);
    expect(revert.dropdownItem(version, ctx)).not.toBeNull();
    expect(ctx.hasObjectPermission).toHaveBeenCalledWith(modify, version);
  });

  it('is shown when the page reports the permission for its repository', () => {
    const ctx = {
      hasPermission: () => false,
      hasObjectPermission: (name: string) => name === modify,
    };

    expect(revert.isShown(version, ctx)).toBe(true);
  });

  it('does not accept the change permission instead', () => {
    const ctx = context({ global: [change] });

    expect(revert.isShown(version, ctx)).toBe(false);
  });
});

// The versions tab of each plugin's repository page offers the revert action
// on every row; what it may check is the repository the page shows.
describe('the revert action in the versions tab of a repository page', () => {
  const TABS = [
    { plugin: 'file', path: 'repositories/file/file', Tab: FileTab },
    { plugin: 'deb', path: 'repositories/deb/apt', Tab: DebTab },
    { plugin: 'rpm', path: 'repositories/rpm/rpm', Tab: RpmTab },
    { plugin: 'python', path: 'repositories/python/python', Tab: PythonTab },
    {
      plugin: 'ansible',
      path: 'repositories/ansible/ansible',
      Tab: AnsibleTab,
    },
  ] as const;

  it.each(TABS)(
    'is shown for a $plugin repository whose own permissions list modify',
    async ({ plugin, path, Tab }) => {
      const { modify } = ACTION_PERMISSIONS[plugin].repository;
      const id = '00000000-0000-4000-8000-0000000000c1';
      const repo = repository({
        name: 'zz-test-repo',
        pulp_href: `${API}/${path}/${id}/`,
      });
      const first = repositoryVersion(repo, 1);
      const second = repositoryVersion(repo, 2);
      const item = { ...repo, latest_version_href: second.pulp_href };
      server.use(
        listOf(`${API}/${path}/:id/versions/`, [second, first]).handler,
      );
      // answers like the page: the target defaults to the repository shown
      const asked: unknown[] = [];
      const hasObjectPermission = (name: string, target: unknown = item) => {
        asked.push(target);
        return target === item && name === modify;
      };
      const Versions = Tab as unknown as ComponentType<{
        item: object;
        actionContext: object;
      }>;

      const { user } = renderWithProviders(
        <Versions
          item={item}
          actionContext={{
            addAlert: vi.fn(),
            hasObjectPermission,
            hasPermission: () => false,
            query: vi.fn(),
            state: { params: {} },
          }}
        />,
      );

      const link = await screen.findByRole('link', { name: /^1/ });
      await user.click(
        within(link.closest('tr') as HTMLElement).getByRole('button', {
          name: 'Actions',
        }),
      );

      expect(
        await screen.findByRole('menuitem', { name: 'Revert to this version' }),
      ).toBeInTheDocument();
      expect(asked.every((target) => target === item)).toBe(true);
    },
  );
});

// The ansible repository actions that are not rows above.
describe('the ansible repository actions that need more than a table row', () => {
  const MODIFY = 'ansible.modify_ansible_repo_content';
  const repo = {
    name: 'zz-test-repo',
    pulp_href: `${API}/repositories/ansible/ansible/00000000-0000-4000-8000-0000000000a1/`,
  };

  describe('the sync action', () => {
    it('does not accept the permission to change a remote instead', () => {
      const ctx = context({
        global: ['ansible.change_collectionremote'],
        object: { [repo.pulp_href]: ['ansible.change_collectionremote'] },
      });

      expect(ansibleRepositorySyncAction.isShown(repo, ctx)).toBe(false);
    });
  });

  // The copy action only reads the distribution of the repository and puts a
  // client configuration on the clipboard: it changes nothing, so it carries
  // no permission and every reader of the repository is offered it.
  describe('the copy action', () => {
    it('declares no permission and is offered to a viewer', () => {
      const ctx = context({ global: ['ansible.view_ansiblerepository'] });

      expect(ansibleRepositoryCopyAction.permission).toBeUndefined();
      expect(ansibleRepositoryCopyAction.isShown(repo, ctx)).toBe(true);
    });
  });

  // The add action sits in the header of the collection versions tab, which
  // has no item: the repository the tab belongs to is what its context
  // answers for.
  describe('the add collection action', () => {
    const add = ansibleRepositoryCollectionVersionAddAction;

    it('is absent, not disabled, for a viewer', () => {
      const ctx = context({ global: ['ansible.view_ansiblerepository'] });

      expect(add.isShown(null, ctx)).toBe(false);
      expect(add.button(null, ctx)).toBeNull();
    });

    it('is shown to a holder of the modify permission on every repository', () => {
      const ctx = context({ global: [MODIFY] });

      expect(add.isShown(null, ctx)).toBe(true);
      expect(shown(add.button(null, ctx))).toBeInTheDocument();
    });

    it('is shown when the repository lists the modify permission', () => {
      const ctx = {
        hasPermission: () => false,
        hasObjectPermission: (name: string) => name === MODIFY,
      };

      expect(add.isShown(null, ctx)).toBe(true);
    });

    it('does not accept the change permission instead', () => {
      const ctx = {
        hasPermission: (name: string) =>
          name === 'ansible.change_ansiblerepository',
        hasObjectPermission: (name: string) =>
          name === 'ansible.change_ansiblerepository',
      };

      expect(add.isShown(null, ctx)).toBe(false);
    });
  });
});
