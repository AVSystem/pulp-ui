import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { type ReactNode, useEffect, useRef } from 'react';
import { DeleteModal } from 'src/components';
import {
  UserRemovalUnconfirmedError,
  useDeleteUser,
} from 'src/entities/core/user/queries';
import { useUserContext } from 'src/user-context';
import { mapErrorMessages } from 'src/utilities/map-error-messages';
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
  // The user to delete: its address and the name the dialog shows.
  user?: { pulp_href: string; username: string };
}

// Why the server did not delete the user, as the alert shows it.
function failureDescription(error): ReactNode {
  const status = requestErrorStatus(error);
  if (status === null) {
    return requestErrorText(error);
  }
  if (status === 403) {
    return requestErrorDescription(error);
  }
  return mapErrorMessages(error)['__nofield'];
}

export const DeleteUserModal = ({
  addAlert,
  closeModal,
  isOpen,
  user,
}: IProps) => {
  const { user: sessionUser } = useUserContext();
  const removal = useDeleteUser();

  // The address of the user the dialog shows right now. The outcome of a
  // removal closes the dialog only while it still shows that user: a dialog
  // that was closed, or opened again for another user, is left as it is.
  const showing = useRef<string | null>(null);
  const shownHref = isOpen && user ? user.pulp_href : null;
  useEffect(() => {
    showing.current = shownHref;
    return () => {
      showing.current = null;
    };
  }, [shownHref]);

  if (!user || !isOpen) {
    return null;
  }

  const waiting = removal.isRemoving(user.pulp_href);

  return (
    <DeleteModal
      cancelAction={() => closeModal(false)}
      deleteAction={() => deleteUser(user)}
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

  // Delete stays disabled with a spinner until the removal is confirmed, so
  // one confirmation sends one request. How the removal ends is reported
  // through the callbacks of the page, whether or not this dialog is still on
  // screen by then.
  function deleteUser(user: NonNullable<IProps['user']>) {
    const { pulp_href: href } = user;
    if (removal.isRemoving(href)) {
      return;
    }

    const stillShown = () => showing.current === href;
    const couldNotDelete = (description: ReactNode) =>
      addAlert(
        t`User "${user.username}" could not be deleted.`,
        'danger',
        description,
      );

    removal.mutate({
      href,
      onDone: (error) => {
        if (!error) {
          addAlert(
            t`User "${user.username}" has been successfully deleted.`,
            'success',
          );
          if (stillShown()) {
            closeModal(true);
          }
          return;
        }

        if (error instanceof UserRemovalUnconfirmedError) {
          // The delete went through but the wait for the user to be gone
          // failed. The session ended: the dialog closes and the list reads
          // again after signing in. Otherwise the dialog stays, so the user
          // sees the alert and decides.
          if (isSessionEnd(error.cause)) {
            if (stillShown()) {
              closeModal(true);
            }
          } else {
            couldNotDelete(requestErrorDescription(error.cause));
          }
          return;
        }

        // The session ended: the user was not deleted and nothing is
        // repeated; the dialog stays so the user can delete after signing in.
        if (isSessionEnd(error)) {
          return;
        }
        couldNotDelete(failureDescription(error));
        if (stillShown()) {
          closeModal(false);
        }
      },
    });
  }
};
