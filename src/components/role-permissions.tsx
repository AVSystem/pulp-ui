import { t } from '@lingui/core/macro';
import { type ReactNode, useEffect, useState } from 'react';
import { RoleAPI } from 'src/api';
import { LoadingSpinner, PermissionCategories } from 'src/components';
import { useSessionEpoch } from 'src/user-context';
import { translateLockedRole } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { ListErrorState } from './list-error-state';

interface IProps {
  name: string;
}

export const RolePermissions = ({ name }: IProps) => {
  const [role, setRole] = useState(null);
  // set when the read failed or no role answered to the name; the reason is
  // empty when the server answered without a role
  const [failure, setFailure] = useState<{ reason: ReactNode } | null>(null);
  // grows when the same user signs in again, so the role reads again
  const epoch = useSessionEpoch();
  // counts the retries, so a failed read can be repeated by hand
  const [attempt, setAttempt] = useState(0);

  // The role on screen stays while it is read again; only the answer replaces
  // it. An answer that arrives after the name changed or the view closed is
  // dropped.
  useEffect(() => {
    let current = true;
    setFailure(null);
    RoleAPI.list({ name })
      .then(({ data }) => {
        if (!current) {
          return;
        }
        const [selectedRole] = data.results;
        if (selectedRole) {
          setRole(selectedRole);
        } else {
          setRole(null);
          setFailure({ reason: null });
        }
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it and the role
        // reads again after signing in. Any other failure is shown with a way
        // to read again, so the view never spins without an end.
        if (!current || isSessionEnd(e)) {
          return;
        }
        setRole(null);
        setFailure({ reason: requestErrorDescription(e) });
      });

    return () => {
      current = false;
    };
  }, [name, epoch, attempt]);

  if (failure) {
    return (
      <ListErrorState
        title={t`Role could not be displayed.`}
        message={failure.reason}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  // A role read for another name is never shown under this one.
  if (!role || role.name !== name) {
    return <LoadingSpinner />;
  }

  return (
    <>
      <p>{translateLockedRole(role.name, role.description)}</p>
      <PermissionCategories permissions={role.permissions} showCustom />
    </>
  );
};
