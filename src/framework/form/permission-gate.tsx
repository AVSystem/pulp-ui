import { t } from '@lingui/core/macro';
import type { ReactNode } from 'react';
import { useAppContext } from 'src/app-context';
import {
  BaseHeader,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  PermissionsFailed,
} from 'src/components';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import { isSessionEnd } from 'src/utilities/request-error';
import {
  type FrameworkPlugin,
  type IPluginPermissions,
  PLUGIN_MANIFESTS,
  type PluginManifest,
} from '../manifest';

interface Props {
  plugin: FrameworkPlugin;
  // The repository or remote the form changes.
  repository: { pulp_href: string };
  // The permission the form needs, picked out of the plugin's manifest, for
  // example `(permissions) => permissions.remote.change`.
  permission: (permissions: IPluginPermissions) => string;
  // The title of the page while it shows something other than the form.
  title: string;
  // True once the user has changed the form. A form the user changed is kept
  // whatever happens to the permission reads, because Pulp decides the save
  // and what was typed is never taken away.
  keep: boolean;
  children: ReactNode;
}

// Shows the form only to a user who is known to hold the permission it needs, on
// every repository or on this one. Until that is known it shows the page's
// loading state, which ends when the reads end. A read that failed is a failure
// to read and not a refusal: it says so and offers to read again. A read that
// stopped because the session ended says nothing, because the sign-in dialog
// explains it and the reads start again after signing in. Only a user whose
// permissions are known to lack the permission sees the insufficient
// permissions page. This is presentation only; Pulp decides every save.
export const FormPermissionGate = ({
  plugin,
  repository,
  permission,
  title,
  keep,
  children,
}: Props) => {
  const {
    hasPermission,
    permissionsReady,
    permissionsFailed,
    permissionsError,
  } = useAppContext();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;
  const name = permission(manifest.permissions);
  const everywhere = hasPermission(name);
  // The roles on single objects matter only to a user who lacks the permission
  // everywhere, once the global permissions are known.
  const objectRoles = useObjectPermissions({
    enabled:
      manifest.permissions.objectRoles && permissionsReady && !everywhere,
  });

  if (keep) {
    return <>{children}</>;
  }

  if (permissionsFailed && !isSessionEnd(permissionsError)) {
    return <PermissionsFailed title={title} />;
  }
  if (!permissionsReady) {
    return <LoadingPage />;
  }
  if (everywhere || objectRoles.can(repository.pulp_href, name)) {
    return <>{children}</>;
  }
  if (!manifest.permissions.objectRoles || objectRoles.state === 'ready') {
    return (
      <>
        <BaseHeader title={title} />
        <InsufficientPermissions />
      </>
    );
  }
  if (objectRoles.state === 'error') {
    return (
      <>
        <BaseHeader title={title} />
        <Main>
          <section className='pulp-section'>
            <ListErrorState
              title={t`Your permissions could not be read`}
              message={t`The roles you hold on single objects could not be read.`}
              onRetry={objectRoles.retry}
            />
          </section>
        </Main>
      </>
    );
  }

  return <LoadingPage />;
};

interface CreateProps {
  plugin: FrameworkPlugin;
  // The permission the form needs, picked out of the plugin's manifest, for
  // example `(permissions) => permissions.remote.add`.
  permission: (permissions: IPluginPermissions) => string;
  title: string;
  children: ReactNode;
}

// The gate of a form that makes a new object. There is no object yet, so no
// role on a single object can grant the permission: only the permissions held on
// every object count. The states are those of FormPermissionGate: the loading
// page until the permissions are known, a failed read says so and offers to
// read again, a session that ended says nothing, and only a user known to lack
// the permission sees the insufficient permissions page. Presentation only;
// Pulp decides every save.
export const CreatePermissionGate = ({
  plugin,
  permission,
  title,
  children,
}: CreateProps) => {
  const {
    hasPermission,
    permissionsReady,
    permissionsFailed,
    permissionsError,
  } = useAppContext();
  const manifest = PLUGIN_MANIFESTS.find(
    (candidate) => candidate.plugin === plugin,
  ) as PluginManifest;

  if (permissionsFailed && !isSessionEnd(permissionsError)) {
    return <PermissionsFailed title={title} />;
  }
  if (!permissionsReady) {
    return <LoadingPage />;
  }
  if (hasPermission(permission(manifest.permissions))) {
    return <>{children}</>;
  }

  return (
    <>
      <BaseHeader title={title} />
      <InsufficientPermissions />
    </>
  );
};
