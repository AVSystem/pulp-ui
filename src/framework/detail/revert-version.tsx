import { t } from '@lingui/core/macro';
import {
  Button,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useId, useRef } from 'react';
import { type AlertType, Spinner } from 'src/components';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useModifyRepository } from 'src/entities/plugin/queries';
import type { RevertBody } from 'src/entities/plugin/repository';
import { handleDialogWriteError } from 'src/utilities/fail-alerts';
import { taskAlert } from 'src/utilities/task-alert';
import type { PluginDescriptor } from '../descriptor';

interface Props {
  // The repository that is reverted and the version whose content it takes.
  repository: RepositoryBase;
  version: { pulp_href: string; number: number };
  // The plugin's repository entity; the action needs its content change.
  entity: PluginDescriptor['repository']['entity'];
  addAlert: (alert: AlertType) => void;
  onClose: () => void;
}

// Asks for confirmation before a repository is reverted to one of its
// versions. The server makes a new latest version with the content of the
// chosen one in a task of its own: no version and no content is deleted, but
// what is served changes with the next publication. One confirmation sends one
// request. The dialog closes once the server has accepted it and an alert
// names the task, so the repository page stays usable while the task runs. A
// refusal or failure is reported in an alert and closes the dialog; a request
// that was not sent because the session ended leaves it open, so one more press
// sends it after signing in again.
export const RevertVersionDialog = ({
  repository,
  version,
  entity,
  addAlert,
  onClose,
}: Props) => {
  const modify = useModifyRepository<RevertBody>(entity);
  const labelId = useId();
  const sending = useRef(false);
  const repositoryName = repository.name;
  const { number } = version;

  async function revert() {
    if (sending.current) {
      return;
    }
    sending.current = true;
    try {
      const task = await modify.mutateAsync({
        href: repository.pulp_href,
        body: { base_version: version.pulp_href },
      });
      addAlert(
        taskAlert(task, t`Revert started for repository "${repositoryName}".`),
      );
      onClose();
    } catch (error) {
      handleDialogWriteError(
        t`Failed to revert repository "${repositoryName}" to version "${number}"`,
        onClose,
        addAlert,
      )(error);
    } finally {
      sending.current = false;
    }
  }

  return (
    <Modal aria-labelledby={labelId} isOpen onClose={onClose} variant='small'>
      <ModalHeader
        labelId={labelId}
        title={t`Revert repository`}
        titleIconVariant='warning'
      />
      <ModalBody>
        <p>{t`Revert repository "${repositoryName}" to version ${number}?`}</p>
        <p>
          {t`The repository gets a new latest version with the content of that version. No version and no content is deleted.`}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button
          key='revert'
          variant='danger'
          onClick={revert}
          isDisabled={modify.isPending}
        >
          {t`Revert`}
          {modify.isPending && <Spinner size='sm' />}
        </Button>
        <Button key='cancel' variant='link' onClick={onClose}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
