// What routing, the menu, the permission table and the end-to-end tools need to
// know about a plugin, as plain data. The entry chunk and the Playwright
// runner both import this module, so it holds no JSX, no message macro, no sdk
// and no component: only types are imported. Everything else about a plugin
// (fields, columns, tabs, entity wiring) lives in its descriptor, which is a
// chunk of its own that loads when one of the plugin's screens is shown.

// The plugins that have screens described by a descriptor.
export type FrameworkPlugin =
  'file' | 'deb' | 'rpm' | 'python' | 'maven' | 'npm' | 'ansible' | 'container';

export type ResourceKind = 'repository' | 'remote' | 'distribution';

// The permission each repository, remote and distribution action needs. The
// names are the permissions the plugin's own viewsets check, so an action is
// shown exactly when the server would let its request through (the server still
// decides every request: hiding an action is presentation only).
export interface IPluginPermissions {
  // true when a role granted on a single repository or remote counts, as the
  // object's own permission list reports it; false when only permissions held
  // on every object decide what is shown
  objectRoles: boolean;
  // The permissions on the plugin's repositories and remotes. A plugin whose
  // screens for them are not on the framework (it has distributions only) may
  // have none; the plugin's own screens then name the permissions they check.
  remote?: RemotePermissions;
  // The permissions on the plugin's distributions: create, change (update and
  // labels) and delete. Which objects a holder may change is decided by the
  // server on every request.
  distribution: {
    add: string;
    change: string;
    delete: string;
  };
  // The permissions on the plugin's publications, for a plugin whose
  // distributions serve from publications. Reading publications is a
  // permission of its own: a user without `view` sees none, which says nothing
  // about whether a distribution serves content.
  publication?: {
    view: string;
    add: string;
    delete: string;
  };
  repository?: RepositoryPermissions;
}

export interface RepositoryPermissions {
  add: string;
  addDistribution: string;
  change: string;
  delete: string;
  manageRoles: string;
  // add and remove content, which is also how a repository is reverted
  modify: string;
  sync: string;
}

export interface RemotePermissions {
  add: string;
  change: string;
  delete: string;
  manageRoles: string;
}

// The repository permissions of a plugin whose repository screens are on the
// framework. Asking for them for any other plugin is a mistake of the caller:
// such a screen is never routed, so this never answers for a user.
export function repositoryPermissions(
  permissions: IPluginPermissions,
): RepositoryPermissions {
  if (!permissions.repository) {
    throw new Error('The plugin has no repository permissions');
  }

  return permissions.repository;
}

// The remote permissions of a plugin whose remote screens are on the
// framework; see repositoryPermissions.
export function remotePermissions(
  permissions: IPluginPermissions,
): RemotePermissions {
  if (!permissions.remote) {
    throw new Error('The plugin has no remote permissions');
  }

  return permissions.remote;
}

export interface PluginManifest {
  // The component name the server reports for the plugin, which the plugin
  // gate of a route compares with the installed plugins.
  plugin: FrameworkPlugin;
  // The plain name the menu shows. The menu translates it where a translation
  // exists; a plain string keeps this module free of the message macro.
  label: string;
  // The kinds of object the plugin has screens for on the framework. Routes
  // and menu entries exist for exactly these kinds: a plugin that lists only
  // some of them keeps its own routes, menu paths and behaviour for the rest.
  resources: ResourceKind[];
  permissions: IPluginPermissions;
  // True once the plugin has screens that come from its descriptor, for the
  // kinds of object `resources` lists.
  onFramework: boolean;
}

export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [
  {
    plugin: 'file',
    label: 'File',
    resources: ['repository', 'remote', 'distribution'],
    permissions: {
      objectRoles: true,
      publication: {
        view: 'file.view_filepublication',
        add: 'file.add_filepublication',
        delete: 'file.delete_filepublication',
      },
      distribution: {
        add: 'file.add_filedistribution',
        change: 'file.change_filedistribution',
        delete: 'file.delete_filedistribution',
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
    onFramework: true,
  },
  {
    plugin: 'deb',
    label: 'deb',
    resources: ['repository', 'remote', 'distribution'],
    // Deb actions follow permissions held on every object only. A role granted
    // on a single deb object does not show its actions, which hides an action
    // the server would allow rather than showing one it would refuse.
    permissions: {
      objectRoles: false,
      publication: {
        view: 'deb.view_aptpublication',
        add: 'deb.add_aptpublication',
        delete: 'deb.delete_aptpublication',
      },
      distribution: {
        add: 'deb.add_aptdistribution',
        change: 'deb.change_aptdistribution',
        delete: 'deb.delete_aptdistribution',
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
    onFramework: true,
  },
  {
    plugin: 'rpm',
    label: 'RPM',
    resources: ['repository', 'remote', 'distribution'],
    permissions: {
      objectRoles: true,
      publication: {
        view: 'rpm.view_rpmpublication',
        add: 'rpm.add_rpmpublication',
        delete: 'rpm.delete_rpmpublication',
      },
      distribution: {
        add: 'rpm.add_rpmdistribution',
        change: 'rpm.change_rpmdistribution',
        delete: 'rpm.delete_rpmdistribution',
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
    onFramework: true,
  },
  {
    plugin: 'python',
    label: 'Python',
    resources: ['repository', 'remote', 'distribution'],
    permissions: {
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
    onFramework: true,
  },
  {
    plugin: 'maven',
    label: 'Maven',
    resources: ['distribution'],
    permissions: {
      objectRoles: true,
      distribution: {
        add: 'maven.add_mavendistribution',
        change: 'maven.change_mavendistribution',
        delete: 'maven.delete_mavendistribution',
      },
    },
    onFramework: true,
  },
  {
    plugin: 'npm',
    label: 'npm',
    resources: ['distribution'],
    permissions: {
      objectRoles: true,
      distribution: {
        add: 'npm.add_npmdistribution',
        change: 'npm.change_npmdistribution',
        delete: 'npm.delete_npmdistribution',
      },
    },
    onFramework: true,
  },
  {
    plugin: 'ansible',
    label: 'Ansible',
    // The plugin's repository, remote and collection screens are its own: only
    // its distributions are on the framework. The permissions of the screens
    // that are not are named here too, because they check the same names.
    resources: ['distribution'],
    permissions: {
      objectRoles: true,
      // The add permission is checked on the model only, never on a single
      // object, which a check on every object already reflects.
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
    onFramework: true,
  },
  {
    plugin: 'container',
    label: 'Container',
    resources: ['distribution'],
    permissions: {
      objectRoles: true,
      // Container distributions are checked against a namespace as well as the
      // model and the object; these are the names the namespace rules check.
      distribution: {
        add: 'container.add_containerdistribution',
        change: 'container.change_containerdistribution',
        delete: 'container.delete_containerdistribution',
      },
    },
    onFramework: true,
  },
];
