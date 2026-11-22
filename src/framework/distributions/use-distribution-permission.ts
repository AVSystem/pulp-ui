import type { ReactNode } from 'react';
import { useAppContext } from 'src/app-context';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import { requestErrorDescription } from 'src/utilities/request-error';
import { useResourcePermission } from '../detail/use-resource-permission';
import {
  type FrameworkPlugin,
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';

// A permission of a distribution's actions, by its key in the plugin's
// manifest.
export type DistributionPermission = keyof IPluginPermissions['distribution'];

// Whether the user may be confirmed to hold a permission on one distribution of
// a plugin, for every plugin alike: it is held on every distribution, or, where
// the plugin's roles can be granted on a single object, held on this one by the
// roles the user has on single objects (see useResourcePermission).
export function useDistributionPermission(
  plugin: FrameworkPlugin,
  distribution: { pulp_href: string } | null | undefined,
  action: DistributionPermission,
): boolean {
  return useResourcePermission(
    plugin,
    distribution,
    (permissions) => permissions.distribution[action],
  );
}

const manifestOf = (plugin: FrameworkPlugin) =>
  PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;

interface Permits {
  permits: (
    action: DistributionPermission,
    row: { pulp_href: string; plugin: FrameworkPlugin | null },
  ) => boolean;
  // A failed read of what the user may do, or null: the reason, when there is
  // one, and the way to read it again. The list says it once.
  failure: { description: ReactNode; retry: () => void } | null;
}

// Whether the user may take an action on a row of the list that holds the
// distributions of every plugin. Each row is judged by the permission of its
// own plugin: held on every distribution, or, for a plugin whose roles can be
// granted on a single object, held on this one according to the roles the user
// has on single objects. Those roles are read once, behind the rows, and only
// when some row's plugin needs them for a user who lacks the permission
// everywhere. Anything not known yet is no, and a failed read says so once,
// with the one button that reads it again; it is never taken for a refusal.
export function useDistributionPermits({
  rows,
  needed,
  rowsShown,
}: {
  rows: readonly { plugin: FrameworkPlugin | null }[];
  // The actions the list may offer on a row.
  needed: readonly DistributionPermission[];
  rowsShown: boolean;
}): Permits {
  const {
    hasPermission,
    permissionsError,
    permissionsFailed,
    permissionsReady,
    retryPermissions,
  } = useAppContext();

  const nameOf = (plugin: FrameworkPlugin, action: DistributionPermission) =>
    manifestOf(plugin).permissions.distribution[action];
  const byObject = (plugin: FrameworkPlugin) =>
    manifestOf(plugin).permissions.objectRoles;

  const needsObjectRoles =
    permissionsReady &&
    rows.some(
      ({ plugin }) =>
        plugin !== null &&
        byObject(plugin) &&
        needed.some((action) => !hasPermission(nameOf(plugin, action))),
    );
  const roles = useObjectPermissions({
    enabled: rowsShown && needsObjectRoles,
  });

  return {
    permits: (action, { pulp_href, plugin }) => {
      if (plugin === null) {
        return false;
      }
      const name = nameOf(plugin, action);

      return (
        hasPermission(name) ||
        (needsObjectRoles && byObject(plugin) && roles.can(pulp_href, name))
      );
    },
    failure:
      permissionsFailed || (needsObjectRoles && roles.state === 'error')
        ? {
            description: permissionsFailed
              ? requestErrorDescription(permissionsError)
              : null,
            retry: permissionsFailed ? retryPermissions : roles.retry,
          }
        : null,
  };
}
