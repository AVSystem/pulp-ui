import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Content } from '@patternfly/react-core';
import { type ReactNode, useState } from 'react';
import { Alert, type AlertType } from 'src/components';
import { DeleteModal } from 'src/components/delete-modal';
import {
  DISTRIBUTION_ENTITIES,
  type DistributionPlugin,
} from 'src/entities/core/distribution/page';
import { useDeleteDistribution } from './delete-distribution';

interface Props {
  plugin: DistributionPlugin;
  distribution: { name: string; base_path: string; pulp_href: string };
  onClose: () => void;
  // Called once the server has accepted the delete, with the alert that says
  // so, and only while the screen the dialog belongs to is still shown. A
  // delete that outlives its screen calls nothing: the alert is queued for the
  // screen the user is on.
  onAccepted: (alert: AlertType) => void;
}

interface Failure {
  message: ReactNode;
  uncertain: boolean;
}

// Confirms the delete of a distribution, naming it and its base path, then
// deletes it with the one helper every distribution delete goes through. What
// the distribution serves is kept: only the address it is served at goes.
//
// The dialog stays open while the request is on its way and after it fails,
// with the reason the server gave, and the button works again. The end of the
// session shows nothing: the sign-in dialog explains it.
export const DeleteDistributionDialog = ({
  plugin,
  distribution,
  onClose,
  onAccepted,
}: Props) => {
  const { name, base_path: basePath, pulp_href } = distribution;
  const { remove, isPending } = useDeleteDistribution(
    DISTRIBUTION_ENTITIES[plugin],
  );
  const [failure, setFailure] = useState<Failure | null>(null);

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
      isDisabled={isPending}
      title={t`Delete distribution?`}
      variant='medium'
    >
      <Content component='p'>
        <Trans>
          Are you sure you want to delete the distribution <b>{name}</b> with
          the base path <b>{basePath}</b>?
        </Trans>
      </Content>
      <Content component='p'>
        {t`What it serves is kept. Clients lose the address it is reached at.`}
      </Content>

      {failure ? (
        <Alert
          isInline
          variant='danger'
          title={
            failure.uncertain
              ? t`The delete stopped with an unexpected error. The distribution may already have been removed: check the list before trying again.`
              : t`Failed to delete distribution "${name}"`
          }
        >
          {failure.message}
        </Alert>
      ) : null}
    </DeleteModal>
  );
};
