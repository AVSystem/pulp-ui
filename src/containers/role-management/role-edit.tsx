import { t } from '@lingui/core/macro';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  RoleForm,
  RoleHeader,
  closeAlert,
} from 'src/components';
import { roleHref } from 'src/entities/core/role/href';
import {
  useRole,
  useUpdateRolePermissions,
} from 'src/entities/core/role/queries';
import { Paths, formatPath } from 'src/paths';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';
import { validateInput } from 'src/utilities/map-role-errors';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { translateLockedRole } from 'src/utilities/translate-locked-role';
import { roleSaveErrors } from './save-errors';

// The permissions of a role that came without any. One value, so the form is
// not told of a change at every render.
const NO_PERMISSIONS: string[] = [];

// The address holds the id of one role. Another role is another screen:
// nothing of the one left behind stays on screen or in the form.
const RoleEdit = () => {
  const { role: urlId } = useParams();

  return <RoleEditScreen key={urlId} urlId={urlId} />;
};

const RoleEditScreen = ({ urlId }: { urlId: string }) => {
  // The id of the address becomes an address of the API only here; an id that
  // is not one has no role and asks for nothing.
  const href = roleHref(urlId);
  const query = useRole(href);
  const updateRole = useUpdateRolePermissions();

  const role = query.data;

  // The description the user typed, or null while the user has not touched it:
  // an untouched form follows every read of the role, a typed description is
  // never replaced by a later read. The permissions follow the same rule inside
  // the form.
  const [typedDescription, setTypedDescription] = useState<string | null>(null);
  const description = typedDescription ?? role?.description ?? '';

  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [redirect, setRedirect] = useState<string>();

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A form on screen is never replaced by the failure of a later read: what
  // was typed stays, and the failure is reported next to it, once.
  const alertedFailure = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded;
  const roleName = role?.name;
  useEffect(() => {
    if (rereadFailed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: roleName
            ? t`Role "${roleName}" could not be displayed.`
            : t`Role could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error, roleName]);

  const saveRole = (permissions: string[] | undefined) => {
    if (updateRole.isPending || !role || !href) {
      return;
    }
    const name = role.name;

    // The promise, not a callback of the screen: the outcome of a save is
    // acted on even when the screen has gone by then.
    updateRole
      .mutateAsync({
        href,
        changes: {
          name,
          // an untouched description goes back as it was read, null included
          description: typedDescription ?? role.description ?? null,
          permissions: permissions ?? [],
        },
      })
      .then(() => setRedirect(formatPath(Paths.core.role.list)))
      .catch((error) => {
        // The session ended: nothing was saved and nothing is repeated; the
        // form stays as typed.
        if (isSessionEnd(error)) {
          return;
        }
        const failure = requestErrorStatus(error);
        if (failure === 400 || failure === 403) {
          setErrorMessages(roleSaveErrors(error));
          return;
        }
        setErrorMessages({});
        setAlerts((current) => [
          ...current,
          {
            variant: 'danger',
            title: t`Changes to role "${name}" could not be saved.`,
            description: requestErrorDescription(error),
          },
        ]);
      });
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  if (href === null || (!role && status === 404)) {
    return <NotFound />;
  }

  if (!role && status === 403) {
    return (
      <>
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!role && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        <BaseHeader title={t`Role`} />
        <Main>
          <ListErrorState
            title={t`Role could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!role) {
    return <LoadingPage />;
  }

  const breadcrumbs = [
    { url: formatPath(Paths.core.role.list), name: t`Roles` },
    { name: role.name },
  ];

  return (
    <>
      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
      <RoleHeader
        title={t`Edit role permissions`}
        subTitle={translateLockedRole(role.name, role.description ?? undefined)}
        breadcrumbs={breadcrumbs}
      />
      <Main>
        <section className='pulp-section'>
          <RoleForm
            name={role.name}
            nameDisabled
            description={description}
            descriptionHelperText={errorMessages['description']}
            descriptionValidated={errorMessages['description'] ? 'error' : null}
            onDescriptionChange={(value) => {
              setTypedDescription(value);
              setErrorMessages((current) =>
                validateInput(value, 'description', current),
              );
            }}
            errorMessage={errorMessages['__nofield']}
            originalPermissions={role.permissions ?? NO_PERMISSIONS}
            saving={updateRole.isPending}
            saveRole={saveRole}
            isSavingDisabled={
              'description' in errorMessages || 'name' in errorMessages
            }
            cancelRole={() => {
              setErrorMessages({});
              setRedirect(formatPath(Paths.core.role.list));
            }}
          />
        </section>
      </Main>
    </>
  );
};

export default RoleEdit;
