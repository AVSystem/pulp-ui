import { describe, expect, it } from 'vitest';
import { ACTION_PERMISSIONS, pluginOfHref } from './action-permissions';

const API = '/pulp/api/v3';
const ID = '00000000-0000-4000-8000-0000000000a1';

describe('pluginOfHref', () => {
  it.each([
    [`${API}/repositories/file/file/${ID}/`, 'file'],
    [`${API}/repositories/deb/apt/${ID}/versions/2/`, 'deb'],
    [`${API}/repositories/rpm/rpm/${ID}/`, 'rpm'],
    [`${API}/repositories/python/python/${ID}/versions/1/`, 'python'],
    [`${API}/repositories/ansible/ansible/${ID}/`, 'ansible'],
    [`${API}/remotes/file/file/${ID}/`, 'file'],
    [`${API}/remotes/ansible/collection/${ID}/`, 'ansible'],
    [`/prefix/api/v3/remotes/deb/apt/${ID}/`, 'deb'],
  ])('reads the plugin of %s', (href, plugin) => {
    expect(pluginOfHref(href)).toBe(plugin);
  });

  it.each([
    undefined,
    null,
    '',
    `${API}/repositories/unknown/thing/${ID}/`,
    `${API}/tasks/${ID}/`,
    `${API}/groups/1/`,
  ])('answers nothing for %s', (href) => {
    expect(pluginOfHref(href)).toBeUndefined();
  });
});

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
});
