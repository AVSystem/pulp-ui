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
import { fileRemoteCreateAction } from './file-remote-create';
import { fileRemoteDeleteAction } from './file-remote-delete';
import { fileRemoteEditAction } from './file-remote-edit';
import { fileRepositoryCreateAction } from './file-repository-create';
import { fileRepositoryDeleteAction } from './file-repository-delete';
import { fileRepositoryEditAction } from './file-repository-edit';
import { fileRepositorySyncAction } from './file-repository-sync';
import { repositoryVersionRevertAction } from './repository-version-revert';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/file/file/00000000-0000-4000-8000-0000000000a1/`;
const REMOTE_HREF = `${API}/remotes/file/file/00000000-0000-4000-8000-0000000000b1/`;

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
}

const repositoryItem = {
  name: 'zz-test-repo',
  pulp_href: REPOSITORY_HREF,
  remote: REMOTE_HREF,
};
const remoteItem = { name: 'zz-test-remote', pulp_href: REMOTE_HREF };

const ROWS: Row[] = [
  {
    label: 'file repository create',
    action: fileRepositoryCreateAction,
    permission: 'file.add_filerepository',
    objectLevel: false,
    item: null,
  },
  {
    label: 'file repository edit',
    action: fileRepositoryEditAction,
    permission: 'file.change_filerepository',
    objectLevel: true,
    item: repositoryItem,
  },
  {
    label: 'file repository sync',
    action: fileRepositorySyncAction,
    permission: 'file.sync_filerepository',
    objectLevel: true,
    item: repositoryItem,
  },
  {
    label: 'file repository delete',
    action: fileRepositoryDeleteAction,
    permission: 'file.delete_filerepository',
    objectLevel: true,
    item: repositoryItem,
  },
  {
    label: 'file remote create',
    action: fileRemoteCreateAction,
    permission: 'file.add_fileremote',
    objectLevel: false,
    item: null,
  },
  {
    label: 'file remote edit',
    action: fileRemoteEditAction,
    permission: 'file.change_fileremote',
    objectLevel: true,
    item: remoteItem,
  },
  {
    label: 'file remote delete',
    action: fileRemoteDeleteAction,
    permission: 'file.delete_fileremote',
    objectLevel: true,
    item: remoteItem,
  },
];

const shown = (node: ReactNode) => {
  render(<>{node}</>);
  return screen.queryByRole('button', { name: /./ });
};

describe.each(ROWS)('the $label action', (row) => {
  const { action, permission, item } = row;

  it('declares its permission and whether objects can grant it', () => {
    expect(action.permission).toBe(permission);
    expect(action.objectLevel).toBe(row.objectLevel);
  });

  it('is absent, not disabled, for a viewer', () => {
    const ctx = context({
      global: ['file.view_filerepository'],
      object: { [REPOSITORY_HREF]: ['file.view_filerepository'] },
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
        object: {
          [REPOSITORY_HREF]: [permission],
          [REMOTE_HREF]: [permission],
        },
      });

      expect(action.isShown(item, ctx)).toBe(false);
      expect(action.isShown(repositoryItem, ctx)).toBe(false);
      expect(ctx.hasObjectPermission).not.toHaveBeenCalled();
    });
  }
});

describe('the sync action of file repositories', () => {
  it('does not accept the change permission any more', () => {
    const ctx = context({ global: ['file.change_filerepository'] });

    expect(fileRepositorySyncAction.isShown(repositoryItem, ctx)).toBe(false);
  });
});

describe('the revert action of a version row', () => {
  const revert = repositoryVersionRevertAction({
    revert: () => Promise.reject(new Error('not used')),
  });
  const row = (plugin: string, repository: string) => ({
    pulp_href: `${API}/repositories/${plugin}/${repository}/00000000-0000-4000-8000-0000000000a1/versions/2/`,
    number: 2,
    isLatest: false,
    repositoryName: 'zz-test-repo',
  });

  it('checks the modify permission of a file repository against the page', () => {
    const version = row('file', 'file');
    const ctx = context({ object: { [REPOSITORY_HREF]: [] } });

    expect(revert.isShown(version, ctx)).toBe(false);
    expect(revert.button(version, ctx)).toBeNull();

    const global = context({ global: ['file.modify_filerepository'] });
    expect(revert.isShown(version, global)).toBe(true);
    expect(global.hasObjectPermission).toHaveBeenCalledWith(
      'file.modify_filerepository',
      version,
    );
  });

  it('is shown when the page reports the permission for its repository', () => {
    const version = row('file', 'file');
    const ctx = {
      hasPermission: () => false,
      hasObjectPermission: (name: string) =>
        name === 'file.modify_filerepository',
    };

    expect(revert.isShown(version, ctx)).toBe(true);
  });

  it('does not accept another permission', () => {
    const version = row('file', 'file');
    const ctx = context({ global: ['file.change_filerepository'] });

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
