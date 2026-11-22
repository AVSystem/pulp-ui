import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  AlertActionLink,
  Content,
  List,
  ListItem,
} from '@patternfly/react-core';
import { type ReactNode, useState } from 'react';
import { Alert, type AlertType, Spinner } from 'src/components';
import { DeleteModal } from 'src/components/delete-modal';
import type { RemoteBase } from 'src/entities/plugin/model';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import { useRemoteUsers } from '../detail/remote-users';
import { useDeleteRemote } from './delete-remote';

interface Props {
  descriptor: PluginDescriptor;
  remote: RemoteBase;
  onClose: () => void;
  // Called once the server has accepted the delete, with the alert that says
  // so, and only while the screen the dialog belongs to is still shown. A
  // delete that outlives its screen calls nothing: the alert is queued for the
  // screen the user is on, and nothing navigates.
  onAccepted: (alert: AlertType) => void;
}

interface Failure {
  message: ReactNode;
  uncertain: boolean;
}

// Confirms the delete of a remote, naming it and the repositories that use it,
// then deletes it with the one helper every remote delete goes through. The
// repositories are kept; they are left without a remote. The delete is offered
// once the users are known, so nobody confirms without seeing what the remote
// is used by; a user who may not list repositories is told so and may still
// confirm, because Pulp decides whether the delete is allowed.
//
// The dialog stays open while the request is on its way and after it fails,
// with the reason, and the button works again. The end of the session shows
// nothing: the sign-in dialog explains it.
export const DeleteRemoteDialog = ({
  descriptor,
  remote,
  onClose,
  onAccepted,
}: Props) => {
  const { name, pulp_href } = remote;
  const entity = descriptor.remote?.entity;

  if (!entity) {
    throw new Error(
      'The plugin declares no remotes, so there is none to delete',
    );
  }

  const users = useRemoteUsers(repositoryOf(descriptor).entity, pulp_href);
  const { remove, isPending } = useDeleteRemote(entity);
  const [failure, setFailure] = useState<Failure | null>(null);

  // A refusal to list the repositories says nothing against the delete.
  const listingRefused =
    users.state === 'error' && requestErrorStatus(users.error) === 403;
  const known = users.state === 'ready' || listingRefused;

  const confirm = async () => {
    setFailure(null);
    const result = await remove({ name, pulp_href }, { onAccepted });
    if (result.status === 'failed') {
      setFailure({ message: result.failure, uncertain: result.uncertain });
    }
  };

  return (
    <DeleteModal
      spinner={isPending}
      cancelAction={onClose}
      deleteAction={confirm}
      isCancelDisabled={isPending}
      isDisabled={isPending || !known}
      title={t`Delete remote?`}
      variant='medium'
    >
      <Content component='p'>
        <Trans>
          Are you sure you want to delete the remote <b>{name}</b>?
        </Trans>
      </Content>

      {users.state === 'loading' ? (
        <Spinner size='md' aria-label={t`Loading repositories`} />
      ) : null}

      {users.state === 'error' && !listingRefused ? (
        <Alert
          isInline
          variant='danger'
          title={t`The repositories that use this remote could not be listed, so nothing can be deleted.`}
          actionLinks={
            <AlertActionLink onClick={users.retry}>{t`Retry`}</AlertActionLink>
          }
        >
          {isSessionEnd(users.error)
            ? null
            : requestErrorDescription(users.error)}
        </Alert>
      ) : null}

      {listingRefused ? (
        <Content component='p'>
          {t`The repositories that use this remote cannot be listed for your account.`}
        </Content>
      ) : null}

      {users.state === 'ready' ? (
        users.total === 0 ? (
          <Content component='p'>{t`No repository uses this remote.`}</Content>
        ) : (
          <>
            <Content component='p'>
              {t`These repositories use this remote. They are kept, without a remote, and cannot be synced until they have one:`}
            </Content>
            <List isPlain>
              {users.users.map(({ pulp_href: href, name: repository }) => (
                <ListItem key={href}>{repository}</ListItem>
              ))}
            </List>
            {users.total > users.users.length ? (
              <Content component='p'>
                {t`And ${users.total - users.users.length} more.`}
              </Content>
            ) : null}
          </>
        )
      ) : null}

      {failure ? (
        <Alert
          isInline
          variant='danger'
          title={
            failure.uncertain
              ? t`The delete stopped with an unexpected error. The remote may already have been removed: check the list before trying again.`
              : t`Failed to delete remote "${name}"`
          }
        >
          {failure.message}
        </Alert>
      ) : null}
    </DeleteModal>
  );
};
