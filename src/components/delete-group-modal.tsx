import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { List, ListItem } from '@patternfly/react-core';
import { Alert, DeleteModal, Spinner } from 'src/components';

interface IProps {
  canViewUsers?: boolean;
  cancelAction: () => void;
  count?: number;
  deleteAction: () => void;
  // True while the deletion is under way: Delete stays disabled with a
  // spinner, so one confirmation sends one request.
  isDeleting?: boolean;
  name: string;
  // The users the deletion affects; only their names are shown.
  users?: { username: string }[];
}

export const DeleteGroupModal = ({
  canViewUsers,
  cancelAction,
  count,
  deleteAction,
  isDeleting,
  name,
  users,
}: IProps) => (
  <DeleteModal
    cancelAction={cancelAction}
    deleteAction={deleteAction}
    isDisabled={isDeleting}
    spinner={isDeleting}
    title={t`Delete group?`}
  >
    <Trans>
      <b>{name}</b> will be permanently deleted.
    </Trans>
    <p>&nbsp;</p>
    <div>
      {users && count > 10 && (
        <p>{t`Deleting this group will affect ${count} users.`}</p>
      )}
      {users && count > 0 && count <= 10 && (
        <>
          <p>{t`These users will lose access to the group content:`}</p>
          <List>
            {users.map((u) => (
              <ListItem key={u.username}>
                <b>{u.username}</b>
              </ListItem>
            ))}
          </List>
        </>
      )}

      {canViewUsers ? (
        <>
          {users && !count && <p>{t`No users will be affected.`}</p>}
          {!users && (
            <p>
              <Trans>
                Checking for affected users... <Spinner size='sm' />
              </Trans>
            </p>
          )}
        </>
      ) : (
        <Alert
          title={t`This group can include users`}
          variant='warning'
          isInline
        >
          {t`You don't have permission to display users.`}
        </Alert>
      )}
    </div>
  </DeleteModal>
);
