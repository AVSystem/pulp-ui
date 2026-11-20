// The permission each repository and remote action needs, per plugin. The
// names are the permissions the plugins' own viewsets check, so an action is
// shown exactly when the server would let its request through (the server
// still decides every request: hiding an action is presentation only).
//
// The entry of a plugin whose screens come from a descriptor is the one in its
// manifest; ansible keeps its own entry here until it has a manifest. The
// import of the manifest is relative on purpose: the end-to-end specs import
// this module and the Playwright runner does not know the `src/` alias.
import {
  type FrameworkPlugin,
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
} from '../framework/manifest';

export type { IPluginPermissions };

export type PermissionPlugin = FrameworkPlugin | 'ansible';

const ANSIBLE: IPluginPermissions = {
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
};

export const ACTION_PERMISSIONS = {
  ...Object.fromEntries(
    PLUGIN_MANIFESTS.map(({ plugin, permissions }) => [plugin, permissions]),
  ),
  ansible: ANSIBLE,
} as Record<PermissionPlugin, IPluginPermissions>;
