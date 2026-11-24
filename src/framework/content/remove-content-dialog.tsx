import { plural, t } from '@lingui/core/macro';
import {
  Button,
  List,
  ListItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useId, useRef } from 'react';
import { type AlertType, Spinner } from 'src/components';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useModifyRepository } from 'src/entities/plugin/queries';
import {
  type ModifyBody,
  removeContentBody,
} from 'src/entities/plugin/repository';
import { handleDialogWriteError } from 'src/utilities/fail-alerts';
import { taskAlert } from 'src/utilities/task-alert';
import type { repositoryOf } from '../descriptor';
import { useWatchTask } from '../watched-tasks';

// How many of the units the confirmation names; the others are counted.
const NAMED = 10;

interface Props {
  repository: RepositoryBase;
  // The plugin's repository entity; the action needs its content change.
  entity: ReturnType<typeof repositoryOf>['entity'];
  // The units to take out, by address, with the name the user knows them by.
  items: readonly { href: string; name: string }[];
  addAlert: (alert: AlertType) => void;
  // Called once the server has accepted the removal, so the screen can drop its
  // selection.
  onRemoved: () => void;
  onClose: () => void;
}

// Asks for confirmation before content is taken out of a repository. The
// server makes one new latest version without the units, in a task of its own,
// so earlier versions keep them and what is served changes with the next
// publication. One confirmation sends one request. The dialog closes once the
// server has accepted it and an alert names the task, so the repository page
// stays usable while the task runs. A refusal or failure is reported in an alert
// and closes the dialog; a request that was not sent because the session ended
// leaves it open, so one more press sends it after signing in again.
export const RemoveContentDialog = ({
  repository,
  entity,
  items,
  addAlert,
  onRemoved,
  onClose,
}: Props) => {
  const modify = useModifyRepository<ModifyBody>(entity);
  const { watch } = useWatchTask();
  const labelId = useId();
  const sending = useRef(false);
  const repositoryName = repository.name;
  const count = items.length;
  const named = items.slice(0, NAMED);
  const others = count - named.length;

  async function remove() {
    if (sending.current) {
      return;
    }
    sending.current = true;
    try {
      const task = await modify.mutateAsync({
        href: repository.pulp_href,
        body: removeContentBody(items.map(({ href }) => href)),
      });
      // The root follows the task to its end wherever the user is by then; the
      // repository and its content are read again then.
      watch({
        href: task,
        label: t`Removal of content from ${repositoryName}`,
        resource: {
          app: entity.app,
          object: entity.object,
          href: repository.pulp_href,
        },
      });
      addAlert(
        taskAlert(task, t`Removal started for repository "${repositoryName}".`),
      );
      onRemoved();
      onClose();
    } catch (error) {
      handleDialogWriteError(
        t`Failed to remove content from repository "${repositoryName}"`,
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
        title={t`Remove content`}
        titleIconVariant='warning'
      />
      <ModalBody>
        <p>
          {plural(count, {
            one: `Remove # item from repository "${repositoryName}"?`,
            other: `Remove # items from repository "${repositoryName}"?`,
          })}
        </p>
        <List isPlain>
          {named.map(({ href, name }) => (
            <ListItem key={href} className='pulp-break-anywhere'>
              {name}
            </ListItem>
          ))}
        </List>
        {others > 0 ? <p>{t`and ${others} more`}</p> : null}
        <p>
          {t`The repository gets a new latest version without them. Earlier versions keep them.`}
        </p>
      </ModalBody>
      <ModalFooter>
        <Button
          key='remove'
          variant='danger'
          onClick={remove}
          isDisabled={modify.isPending}
        >
          {t`Remove`}
          {modify.isPending && <Spinner size='sm' />}
        </Button>
        <Button key='cancel' variant='link' onClick={onClose}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
