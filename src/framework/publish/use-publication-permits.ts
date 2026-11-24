import { useAppContext } from 'src/app-context';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import { type FrameworkPlugin, PLUGIN_MANIFESTS } from '../manifest';

// Which of a repository's publications the user may delete: the delete
// permission is held on every publication, or, for a plugin whose roles can be
// granted on a single object, on this one by a role the user has on it. The
// object roles are read only for a user who lacks the permission everywhere and
// only when some publication is shown. Anything not known yet is no: nothing is
// offered on a guess, and Pulp decides every request it is sent.
export function usePublicationDeletePermits(
  plugin: FrameworkPlugin,
  { rowsShown }: { rowsShown: boolean },
): (publication: { pulp_href: string }) => boolean {
  const { hasPermission, permissionsReady } = useAppContext();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  );
  const name = manifest?.permissions.publication?.delete;
  const everywhere = name !== undefined && hasPermission(name);
  const needsObjectRoles =
    manifest?.permissions.objectRoles === true &&
    name !== undefined &&
    permissionsReady &&
    !everywhere;
  const roles = useObjectPermissions({
    enabled: rowsShown && needsObjectRoles,
  });

  return ({ pulp_href }) =>
    name !== undefined &&
    (everywhere || (needsObjectRoles && roles.can(pulp_href, name)));
}
