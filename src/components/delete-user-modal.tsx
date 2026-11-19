import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { UserAPI } from 'src/api';
import { DeleteModal } from 'src/components';
import { useUserContext } from 'src/user-context';
import { mapErrorMessages } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
  requestErrorText,
} from 'src/utilities/request-error';

interface IProps {
  addAlert: (message, variant, description?) => void;
  closeModal: (didDelete: boolean) => void;
  isOpen: boolean;
  user?: { id?: number | null; username: string };
}

export const DeleteUserModal = ({
  addAlert,
  closeModal,
  isOpen,
  user,
}: IProps) => {
  const [waiting, setWaiting] = useState(false);
  const { user: sessionUser } = useUserContext();
  // Whether the dialog is still on screen, so the wait for the removal stops
  // reading the user once it has been closed or taken away.
  const shown = useRef(isOpen);
  useEffect(() => {
    shown.current = isOpen;
    return () => {
      shown.current = false;
    };
  }, [isOpen]);

  if (!user || !isOpen) {
    return null;
  }

  return (
    <DeleteModal
      cancelAction={() => closeModal(false)}
      deleteAction={() => deleteUser()}
      isDisabled={waiting || user.username === sessionUser?.username}
      spinner={waiting}
      title={t`Delete user?`}
    >
      {user.username === sessionUser?.username ? (
        t`Deleting yourself is not allowed.`
      ) : (
        <Trans>
          <b>{user.username}</b> will be permanently deleted.
        </Trans>
      )}
    </DeleteModal>
  );

  // Delete stays disabled with a spinner until the removal is confirmed, so one
  // confirmation sends one request.
  async function deleteUser() {
    setWaiting(true);
    try {
      try {
        await UserAPI.delete(user.id);
      } catch (err) {
        // The session ended: the user was not deleted and nothing is
        // repeated; the dialog stays so the user can delete after signing in.
        if (isSessionEnd(err)) {
          return;
        }
        addAlert(
          t`User "${user.username}" could not be deleted.`,
          'danger',
          requestErrorStatus(err) === null
            ? requestErrorText(err)
            : mapErrorMessages(err)['__nofield'],
        );
        closeModal(false);
        return;
      }

      await waitForDeleteConfirm();
    } finally {
      setWaiting(false);
    }
  }

  // Wait for the user to actually get removed from the database before
  // closing, reading again every half second until the user is gone or the
  // dialog is.
  async function waitForDeleteConfirm() {
    while (shown.current) {
      try {
        await UserAPI.get(user.id as unknown as string);
      } catch (err) {
        // The session ended while waiting for the removal to show: the delete
        // itself went through, so the dialog closes and the list reads again
        // after signing in.
        if (isSessionEnd(err)) {
          closeModal(true);
        } else if (requestErrorStatus(err) === 404) {
          addAlert(
            t`User "${user.username}" has been successfully deleted.`,
            'success',
          );
          closeModal(true);
        } else {
          addAlert(
            t`User "${user.username}" could not be deleted.`,
            'danger',
            requestErrorDescription(err),
          );
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
};
