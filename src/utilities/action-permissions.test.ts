import { describe, expect, it } from 'vitest';
import { ACTION_PERMISSIONS } from './action-permissions';

describe('ACTION_PERMISSIONS', () => {
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
