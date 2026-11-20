import { useAppContext } from 'src/app-context';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import type { RepositoryBase } from 'src/entities/plugin/model';
import {
  type FrameworkPlugin,
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';

// A permission of a repository's actions, by its key in the plugin's manifest.
type RepositoryPermission = keyof IPluginPermissions['repository'];

// Whether the user may be confirmed to hold a permission on a repository: it is
// held on every repository, or, for a plugin whose roles can be granted on a
// single repository, held on this one by the roles the user has on single
// objects. Those roles are read only for a user who lacks the permission
// everywhere, and only once the repository is on screen. Anything not known
// yet, or not readable, is no: nothing is drawn on a guess, and Pulp decides
// every request it is sent.
export function useRepositoryPermission(
  plugin: FrameworkPlugin,
  repository: RepositoryBase | null | undefined,
  permission: RepositoryPermission,
): boolean {
  const { hasPermission, permissionsReady } = useAppContext();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const name = manifest.permissions.repository[permission];
  const everywhere = hasPermission(name);
  const needsObjectRoles =
    manifest.permissions.objectRoles &&
    permissionsReady &&
    !everywhere &&
    !!repository;
  const objectRoles = useObjectPermissions({ enabled: needsObjectRoles });

  return (
    !!repository &&
    (everywhere ||
      (needsObjectRoles && objectRoles.can(repository.pulp_href, name)))
  );
}
