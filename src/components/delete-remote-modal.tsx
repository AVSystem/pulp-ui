import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Content } from '@patternfly/react-core';
import { useState } from 'react';
import { DeleteModal } from 'src/components';

interface IProps {
  closeAction: () => void;
  // Starts the delete. When it answers with a promise, Delete stays disabled
  // with a spinner until that promise has settled, so one confirmation sends
  // one request.
  deleteAction: () => unknown;
  name: string;
}

export const DeleteRemoteModal = ({
  closeAction,
  deleteAction,
  name,
}: IProps) => {
  const [pending, setPending] = useState(false);

  if (!name) {
    return null;
  }

  return (
    <DeleteModal
      spinner={pending}
      cancelAction={closeAction}
      deleteAction={() => {
        setPending(true);
        Promise.resolve(deleteAction()).finally(() => setPending(false));
      }}
      isDisabled={pending}
      title={t`Delete remote?`}
    >
      <Content component='p'>
        <Trans>
          Are you sure you want to delete the remote <b>{name}</b>?<br />
          <b>Note:</b> This will also delete all associated resources under this
          remote.
        </Trans>
      </Content>
    </DeleteModal>
  );
};
