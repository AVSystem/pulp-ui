import type { RemoteBase } from 'src/entities/plugin/model';
import {
  type FrameworkPlugin,
  type RemotePermissions,
  remotePermissions,
} from '../manifest';
import { useResourcePermission } from './use-resource-permission';

// A permission of a remote's actions, by its key in the plugin's manifest.
type RemotePermission = keyof RemotePermissions;

// Whether the user may be confirmed to hold a permission on a remote (see
// useResourcePermission).
export function useRemotePermission(
  plugin: FrameworkPlugin,
  remote: RemoteBase | null | undefined,
  permission: RemotePermission,
): boolean {
  return useResourcePermission(
    plugin,
    remote,
    (permissions) => remotePermissions(permissions)[permission],
  );
}
