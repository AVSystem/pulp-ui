import { useAppContext } from 'src/app-context';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import {
  type FrameworkPlugin,
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';

// Whether the user may be confirmed to hold a permission on one object of a
// plugin, a repository or a remote: it is held on every object, or, for a
// plugin whose roles can be granted on a single object, held on this one by the
// roles the user has on single objects. Those roles are read only for a user
// who lacks the permission everywhere, and only once the object is on screen.
// Anything not known yet, or not readable, is no: nothing is drawn on a guess,
// and Pulp decides every request it is sent.
//
// `permission` picks the permission name out of the plugin's manifest, for
// example `(permissions) => permissions.remote.change`.
export function useResourcePermission(
  plugin: FrameworkPlugin,
  object: { pulp_href: string } | null | undefined,
  permission: (permissions: IPluginPermissions) => string,
): boolean {
  const { hasPermission, permissionsReady } = useAppContext();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const name = permission(manifest.permissions);
  const everywhere = hasPermission(name);
  const needsObjectRoles =
    manifest.permissions.objectRoles &&
    permissionsReady &&
    !everywhere &&
    !!object;
  const objectRoles = useObjectPermissions({ enabled: needsObjectRoles });

  return (
    !!object &&
    (everywhere ||
      (needsObjectRoles && objectRoles.can(object.pulp_href, name)))
  );
}
