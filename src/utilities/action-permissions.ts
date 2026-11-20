// The permission each repository and remote action needs, per plugin. The
// names are the permissions the plugins' own viewsets check, so an action is
// shown exactly when the server would let its request through (the server
// still decides every request: hiding an action is presentation only).

export type PermissionPlugin = 'file' | 'deb' | 'rpm' | 'python' | 'ansible';

export interface IPluginPermissions {
  // true when a role granted on a single repository or remote counts, as the
  // object's own permission list reports it; false when only permissions held
  // on every object decide what is shown
  objectRoles: boolean;
  remote: {
    add: string;
    change: string;
    delete: string;
    manageRoles: string;
  };
  repository: {
    add: string;
    addDistribution: string;
    change: string;
    delete: string;
    manageRoles: string;
    // add and remove content, which is also how a repository is reverted
    modify: string;
    sync: string;
  };
}

export const ACTION_PERMISSIONS: Record<PermissionPlugin, IPluginPermissions> =
  {
    file: {
      objectRoles: true,
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
    // Deb actions follow permissions held on every object only. A role granted
    // on a single deb object does not show its actions, which hides an action
    // the server would allow rather than showing one it would refuse.
    deb: {
      objectRoles: false,
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
