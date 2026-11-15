import { useEffect, useState } from 'react';
import { RoleAPI } from 'src/api';
import { LoadingSpinner, PermissionCategories } from 'src/components';
import { useSessionEpoch } from 'src/user-context';
import { translateLockedRole } from 'src/utilities';
import { isSessionEnd } from 'src/utilities/request-error';

interface IProps {
  name: string;
}

export const RolePermissions = ({ name }: IProps) => {
  const [role, setRole] = useState(null);
  // grows when the same user signs in again, so the role reads again
  const epoch = useSessionEpoch();

  // The role on screen stays while it is read again; only the answer replaces it.
  useEffect(() => {
    RoleAPI.list({ name })
      .then(({ data }) => {
        const [selectedRole] = data.results;
        setRole(selectedRole);
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it and the role
        // reads again after signing in.
        if (!isSessionEnd(e)) {
          throw e;
        }
      });
  }, [epoch]);

  if (!role) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <p>{translateLockedRole(role.name, role.description)}</p>
      <PermissionCategories permissions={role.permissions} showCustom />
    </>
  );
};
