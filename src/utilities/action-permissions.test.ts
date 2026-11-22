import { describe, expect, it } from 'vitest';
import { HREF_PLUGINS } from 'src/entities/href';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { ACTION_PERMISSIONS } from './action-permissions';

describe('ACTION_PERMISSIONS', () => {
  it('has an entry for exactly the plugins an address can name', () => {
    expect(Object.keys(ACTION_PERMISSIONS).sort()).toEqual(
      [...HREF_PLUGINS].sort(),
    );
  });

  it('names the permissions of each plugin with its own app label', () => {
    for (const [plugin, entry] of Object.entries(ACTION_PERMISSIONS)) {
      const names = [
        ...Object.values(entry.repository),
        ...Object.values(entry.remote),
      ];
      expect(names.length).toBeGreaterThan(0);
      for (const name of names) {
        expect(name.startsWith(`${plugin}.`)).toBe(true);
      }
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('lets a role on a single object count for every plugin except deb', () => {
    expect(ACTION_PERMISSIONS.file.objectRoles).toBe(true);
    expect(ACTION_PERMISSIONS.rpm.objectRoles).toBe(true);
    expect(ACTION_PERMISSIONS.python.objectRoles).toBe(true);
    expect(ACTION_PERMISSIONS.ansible.objectRoles).toBe(true);
    expect(ACTION_PERMISSIONS.deb.objectRoles).toBe(false);
  });

  it('syncs with the sync permission of the repository model', () => {
    expect(ACTION_PERMISSIONS.file.repository.sync).toBe(
      'file.sync_filerepository',
    );
    expect(ACTION_PERMISSIONS.deb.repository.sync).toBe(
      'deb.sync_aptrepository',
    );
    expect(ACTION_PERMISSIONS.rpm.repository.sync).toBe(
      'rpm.sync_rpmrepository',
    );
    expect(ACTION_PERMISSIONS.python.repository.sync).toBe(
      'python.sync_pythonrepository',
    );
    expect(ACTION_PERMISSIONS.ansible.repository.sync).toBe(
      'ansible.sync_ansiblerepository',
    );
  });

  it('names the permission that changes the content of a repository', () => {
    expect(ACTION_PERMISSIONS.file.repository.modify).toBe(
      'file.modify_filerepository',
    );
    expect(ACTION_PERMISSIONS.deb.repository.modify).toBe(
      'deb.modify_content_aptrepository',
    );
    expect(ACTION_PERMISSIONS.rpm.repository.modify).toBe(
      'rpm.modify_content_rpmrepository',
    );
    expect(ACTION_PERMISSIONS.python.repository.modify).toBe(
      'python.modify_pythonrepository',
    );
    expect(ACTION_PERMISSIONS.ansible.repository.modify).toBe(
      'ansible.modify_ansible_repo_content',
    );
  });

  it('names the role management and distribution permissions of file', () => {
    expect(ACTION_PERMISSIONS.file.repository.manageRoles).toBe(
      'file.manage_roles_filerepository',
    );
    expect(ACTION_PERMISSIONS.file.repository.addDistribution).toBe(
      'file.add_filedistribution',
    );
  });

  it('names the permission that manages the roles of a remote', () => {
    expect(ACTION_PERMISSIONS.file.remote.manageRoles).toBe(
      'file.manage_roles_fileremote',
    );
    expect(ACTION_PERMISSIONS.deb.remote.manageRoles).toBe(
      'deb.manage_roles_aptremote',
    );
    expect(ACTION_PERMISSIONS.rpm.remote.manageRoles).toBe(
      'rpm.manage_roles_rpmremote',
    );
    expect(ACTION_PERMISSIONS.python.remote.manageRoles).toBe(
      'python.manage_roles_pythonremote',
    );
    expect(ACTION_PERMISSIONS.ansible.remote.manageRoles).toBe(
      'ansible.manage_roles_collectionremote',
    );
  });
});

// The table as it was written by hand, before it was built from the manifests.
// It stays a literal so a change to a permission name is a deliberate edit of
// this file too.
const LITERAL = {
  file: {
    objectRoles: true,
    distribution: {
      add: 'file.add_filedistribution',
      change: 'file.change_filedistribution',
      delete: 'file.delete_filedistribution',
    },
    publication: {
      view: 'file.view_filepublication',
      add: 'file.add_filepublication',
      delete: 'file.delete_filepublication',
    },
    repository: {
      add: 'file.add_filerepository',
      addDistribution: 'file.add_filedistribution',
      change: 'file.change_filerepository',
      delete: 'file.delete_filerepository',
      manageRoles: 'file.manage_roles_filerepository',
      modify: 'file.modify_filerepository',
      sync: 'file.sync_filerepository',
    },
    remote: {
      add: 'file.add_fileremote',
      change: 'file.change_fileremote',
      delete: 'file.delete_fileremote',
      manageRoles: 'file.manage_roles_fileremote',
    },
  },
  deb: {
    objectRoles: false,
    distribution: {
      add: 'deb.add_aptdistribution',
      change: 'deb.change_aptdistribution',
      delete: 'deb.delete_aptdistribution',
    },
    publication: {
      view: 'deb.view_aptpublication',
      add: 'deb.add_aptpublication',
      delete: 'deb.delete_aptpublication',
    },
    repository: {
      add: 'deb.add_aptrepository',
      addDistribution: 'deb.add_aptdistribution',
      change: 'deb.change_aptrepository',
      delete: 'deb.delete_aptrepository',
      manageRoles: 'deb.manage_roles_aptrepository',
      modify: 'deb.modify_content_aptrepository',
      sync: 'deb.sync_aptrepository',
    },
    remote: {
      add: 'deb.add_aptremote',
      change: 'deb.change_aptremote',
      delete: 'deb.delete_aptremote',
      manageRoles: 'deb.manage_roles_aptremote',
    },
  },
  rpm: {
    objectRoles: true,
    distribution: {
      add: 'rpm.add_rpmdistribution',
      change: 'rpm.change_rpmdistribution',
      delete: 'rpm.delete_rpmdistribution',
    },
    publication: {
      view: 'rpm.view_rpmpublication',
      add: 'rpm.add_rpmpublication',
      delete: 'rpm.delete_rpmpublication',
    },
    repository: {
      add: 'rpm.add_rpmrepository',
      addDistribution: 'rpm.add_rpmdistribution',
      change: 'rpm.change_rpmrepository',
      delete: 'rpm.delete_rpmrepository',
      manageRoles: 'rpm.manage_roles_rpmrepository',
      modify: 'rpm.modify_content_rpmrepository',
      sync: 'rpm.sync_rpmrepository',
    },
    remote: {
      add: 'rpm.add_rpmremote',
      change: 'rpm.change_rpmremote',
      delete: 'rpm.delete_rpmremote',
      manageRoles: 'rpm.manage_roles_rpmremote',
    },
  },
  python: {
    objectRoles: true,
    distribution: {
      add: 'python.add_pythondistribution',
      change: 'python.change_pythondistribution',
      delete: 'python.delete_pythondistribution',
    },
    repository: {
      add: 'python.add_pythonrepository',
      addDistribution: 'python.add_pythondistribution',
      change: 'python.change_pythonrepository',
      delete: 'python.delete_pythonrepository',
      manageRoles: 'python.manage_roles_pythonrepository',
      modify: 'python.modify_pythonrepository',
      sync: 'python.sync_pythonrepository',
    },
    remote: {
      add: 'python.add_pythonremote',
      change: 'python.change_pythonremote',
      delete: 'python.delete_pythonremote',
      manageRoles: 'python.manage_roles_pythonremote',
    },
  },
  ansible: {
    objectRoles: true,
    distribution: {
      add: 'ansible.add_ansibledistribution',
      change: 'ansible.change_ansibledistribution',
      delete: 'ansible.delete_ansibledistribution',
    },
    repository: {
      add: 'ansible.add_ansiblerepository',
      addDistribution: 'ansible.add_ansibledistribution',
      change: 'ansible.change_ansiblerepository',
      delete: 'ansible.delete_ansiblerepository',
      manageRoles: 'ansible.manage_roles_ansiblerepository',
      modify: 'ansible.modify_ansible_repo_content',
      sync: 'ansible.sync_ansiblerepository',
    },
    remote: {
      add: 'ansible.add_collectionremote',
      change: 'ansible.change_collectionremote',
      delete: 'ansible.delete_collectionremote',
      manageRoles: 'ansible.manage_roles_collectionremote',
    },
  },
};

describe('ACTION_PERMISSIONS built from the manifests', () => {
  it('holds exactly the values the hand-written table held', () => {
    expect(ACTION_PERMISSIONS).toEqual(LITERAL);
  });

  it('takes the entry of every plugin that has repository and remote permissions from its manifest', () => {
    const withBoth = PLUGIN_MANIFESTS.filter(
      ({ permissions }) => permissions.repository && permissions.remote,
    );

    expect(withBoth.map(({ plugin }) => plugin)).toEqual([
      'file',
      'deb',
      'rpm',
      'python',
      'ansible',
    ]);
    for (const manifest of withBoth) {
      expect(
        ACTION_PERMISSIONS[manifest.plugin as keyof typeof ACTION_PERMISSIONS],
      ).toBe(manifest.permissions);
    }
  });

  it('has no entry for a plugin that has no repository or remote screens', () => {
    for (const plugin of ['maven', 'npm', 'container']) {
      expect(Object.keys(ACTION_PERMISSIONS)).not.toContain(plugin);
    }
  });
});
