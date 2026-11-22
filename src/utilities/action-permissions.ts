// The permission each repository and remote action needs, per plugin. The
// names are the permissions the plugins' own viewsets check, so an action is
// shown exactly when the server would let its request through (the server
// still decides every request: hiding an action is presentation only).
//
// The entry of a plugin is the one in its manifest, for every plugin that has
// both repository and remote permissions there (a plugin that has
// distributions only has none of its own). The import of the manifest is
// relative on purpose: the end-to-end specs import this module and the
// Playwright runner does not know the `src/` alias.
import {
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
  type RemotePermissions,
  type RepositoryPermissions,
} from '../framework/manifest';

export type { IPluginPermissions };

export type PermissionPlugin = 'file' | 'deb' | 'rpm' | 'python' | 'ansible';

// The permissions of a plugin that has repository and remote screens, its own
// or the framework's.
export type ScreenPermissions = IPluginPermissions & {
  repository: RepositoryPermissions;
  remote: RemotePermissions;
};

export const ACTION_PERMISSIONS = Object.fromEntries(
  PLUGIN_MANIFESTS.filter(
    ({ permissions }) => permissions.repository && permissions.remote,
  ).map(({ plugin, permissions }) => [plugin, permissions]),
) as Record<PermissionPlugin, ScreenPermissions>;
