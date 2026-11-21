// What routing, the menu, the permission table and the end-to-end tools need to
// know about a plugin, as plain data. The entry chunk and the Playwright
// runner both import this module, so it holds no JSX, no message macro, no sdk
// and no component: only types are imported. Everything else about a plugin
// (fields, columns, tabs, entity wiring) lives in its descriptor, which is a
// chunk of its own that loads when one of the plugin's screens is shown.

// The plugins whose repositories and remotes are described by a descriptor.
export type FrameworkPlugin = 'file' | 'deb' | 'rpm' | 'python';

export type ResourceKind = 'repository' | 'remote';

// The permission each repository and remote action needs. The names are the
// permissions the plugin's own viewsets check, so an action is shown exactly
// when the server would let its request through (the server still decides every
// request: hiding an action is presentation only).
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

export interface PluginManifest {
  // The component name the server reports for the plugin, which the plugin
  // gate of a route compares with the installed plugins.
  plugin: FrameworkPlugin;
  // The plain name the menu shows. The menu translates it where a translation
  // exists; a plain string keeps this module free of the message macro.
  label: string;
  // The kinds of object the plugin has screens for. A plugin that has only
  // some of them lists only those.
  resources: ResourceKind[];
  permissions: IPluginPermissions;
  // True once the plugin's screens come from its descriptor. Until then its
  // routes, menu paths and behaviour stay exactly as they are.
  onFramework: boolean;
}

export const PLUGIN_MANIFESTS: readonly PluginManifest[] = [
  {
    plugin: 'file',
    label: 'File',
    resources: ['repository', 'remote'],
    permissions: {
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
    onFramework: true,
  },
  {
    plugin: 'deb',
    label: 'deb',
    resources: ['repository', 'remote'],
    // Deb actions follow permissions held on every object only. A role granted
    // on a single deb object does not show its actions, which hides an action
    // the server would allow rather than showing one it would refuse.
    permissions: {
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
    onFramework: true,
  },
  {
    plugin: 'rpm',
    label: 'RPM',
    resources: ['repository', 'remote'],
    permissions: {
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
    onFramework: true,
  },
  {
    plugin: 'python',
    label: 'Python',
    resources: ['repository', 'remote'],
    permissions: {
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
    onFramework: false,
  },
];
