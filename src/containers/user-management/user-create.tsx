import { t } from '@lingui/core/macro';
import { useState } from 'react';
import { Navigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import { PermissionsFailed, UserFormPage } from 'src/components';
import {
  type UserFormValues,
  emptyUserForm,
  userCreateBody,
} from 'src/entities/core/user/form';
import { useCreateUser } from 'src/entities/core/user/queries';
import { Paths, formatPath } from 'src/paths';
import { type ErrorMessagesType } from 'src/utilities/map-error-messages';
import { isSessionEnd } from 'src/utilities/request-error';
import { userSaveErrors } from './save-errors';

const UserCreate = () => {
  const createUser = useCreateUser();
  const { permissionsFailed, permissionsError } = useAppContext();

  const [errorMessages, setErrorMessages] = useState<ErrorMessagesType>({});
  const [redirect, setRedirect] = useState<string>();
  const [form, setForm] = useState<UserFormValues>(emptyUserForm);
  // true once the form was changed: it then stays when the permissions cannot
  // be read, so what was typed is never thrown away
  const [touched, setTouched] = useState(false);

  const saveUser = () => {
    if (createUser.isPending) {
      return;
    }

    createUser
      .mutateAsync(userCreateBody(form))
      .then(() => setRedirect(formatPath(Paths.core.user.list)))
      .catch((error) => setErrorMessages(userSaveErrors(error)));
  };

  if (redirect) {
    return <Navigate to={redirect} />;
  }

  const title = t`Create new user`;

  // A permission read that stopped only because the session ended is not a
  // failure to show: the sign-in dialog explains it.
  if (permissionsFailed && !isSessionEnd(permissionsError) && !touched) {
    return <PermissionsFailed title={title} />;
  }

  const breadcrumbs = [
    { url: formatPath(Paths.core.user.list), name: t`Users` },
    { name: title },
  ];

  return (
    <UserFormPage
      breadcrumbs={breadcrumbs}
      errorMessages={errorMessages}
      isNewUser
      onCancel={() => setRedirect(formatPath(Paths.core.user.list))}
      saveUser={saveUser}
      title={title}
      updateUser={(next, errors) => {
        setTouched(true);
        setErrorMessages(errors);
        setForm(next);
      }}
      user={form}
    />
  );
};

export default UserCreate;
