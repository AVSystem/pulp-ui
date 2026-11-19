import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { Navigate } from 'react-router';
import {
  AlertList,
  type AlertType,
  Main,
  RoleForm,
  RoleHeader,
  closeAlert,
} from 'src/components';
import { useCreateRole } from 'src/entities/core/role/queries';
import { Paths, formatPath } from 'src/paths';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';
import { validateInput } from 'src/utilities/map-role-errors';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { roleSaveErrors } from './save-errors';

const RoleCreate = () => {
  const createRole = useCreateRole();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [redirect, setRedirect] = useState<string>();

  const saveRole = (permissions: string[] | undefined) => {
    if (createRole.isPending) {
      return;
    }

    const form = { name, description };

    // The promise, not a callback of the screen: the outcome of a save is
    // acted on even when the screen has gone by then.
    createRole
      .mutateAsync({ ...form, permissions: permissions ?? [] })
      .then(() => {
        setErrorMessages({});
        setRedirect(formatPath(Paths.core.role.list));
      })
      .catch((error) => {
        // The session ended: nothing was created and nothing is repeated; the
        // form stays as typed.
        if (isSessionEnd(error)) {
          return;
        }
        const status = requestErrorStatus(error);
        if (status === 400 || status === 403) {
          setErrorMessages(roleSaveErrors(error));
          return;
        }
        setErrorMessages({});
        setAlerts((current) => [
          ...current,
          {
            variant: 'danger',
            title: t`Role "${form.name}" could not be created.`,
            description: requestErrorDescription(error),
          },
        ]);
      });
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  const breadcrumbs = [
    { url: formatPath(Paths.core.role.list), name: t`Roles` },
    { name: t`Create new role` },
  ];

  const typed = (field: 'name' | 'description', value: string) => {
    if (field === 'name') {
      setName(value);
    } else {
      setDescription(value);
    }
    setErrorMessages((current) => validateInput(value, field, current));
  };

  return (
    <>
      <AlertList
        alerts={alerts}
        closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
      />
      <RoleHeader title={t`Create a new role`} breadcrumbs={breadcrumbs} />
      <Main>
        <section className='pulp-section'>
          <RoleForm
            nameValidated={errorMessages['name'] ? 'error' : null}
            nameHelperText={errorMessages['name']}
            name={name}
            onNameChange={(value) => typed('name', value)}
            description={description}
            descriptionValidated={errorMessages['description'] ? 'error' : null}
            descriptionHelperText={errorMessages['description']}
            onDescriptionChange={(value) => typed('description', value)}
            errorMessage={errorMessages['__nofield']}
            saveRole={saveRole}
            isSavingDisabled={
              'description' in errorMessages || 'name' in errorMessages
            }
            cancelRole={() => {
              setErrorMessages({});
              setRedirect(formatPath(Paths.core.role.list));
            }}
            saving={createRole.isPending}
          />
        </section>
      </Main>
    </>
  );
};

export default RoleCreate;
