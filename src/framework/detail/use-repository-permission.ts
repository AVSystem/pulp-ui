import type { RepositoryBase } from 'src/entities/plugin/model';
import type { FrameworkPlugin, IPluginPermissions } from '../manifest';
import { useResourcePermission } from './use-resource-permission';

// A permission of a repository's actions, by its key in the plugin's manifest.
type RepositoryPermission = keyof IPluginPermissions['repository'];

// Whether the user may be confirmed to hold a permission on a repository (see
// useResourcePermission).
export function useRepositoryPermission(
  plugin: FrameworkPlugin,
  repository: RepositoryBase | null | undefined,
  permission: RepositoryPermission,
): boolean {
  return useResourcePermission(
    plugin,
    repository,
    (permissions) => permissions.repository[permission],
  );
}
