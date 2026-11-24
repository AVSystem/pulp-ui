import { t } from '@lingui/core/macro';
import {
  Button,
  Form,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useId, useRef, useState } from 'react';
import { Alert, Spinner } from 'src/components';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { PublishBody } from 'src/entities/plugin/publication';
import { usePublish } from 'src/entities/plugin/queries';
import type { PluginDescriptor } from '../descriptor';
import { saveFailure } from '../form/save-errors';
import { OptionField, initialValues } from '../sync/sync-dialog';
import { useWatchTask } from '../watched-tasks';

// The version a publish is made from: its number, which names it for the user,
// and its address, which the request sends.
export interface PublishVersion {
  number: number;
  pulp_href: string;
}

interface Props {
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  // The version to publish; without one the repository's latest version is
  // published.
  version?: PublishVersion | null;
  // Called when the dialog is to go away: after a publish was accepted, or when
  // the user closes it. It cannot be closed while the request is on its way.
  onClose: () => void;
  // Called once, with the address of the task, when the server has accepted the
  // publish and before the dialog closes.
  onStarted?: (task: string) => void;
}

// The dialog that starts a publish of one repository: its latest version or
// one version, with the options of the plugin. The options start from what the
// server would use, and only an option the user changed is sent. The dialog
// closes as soon as the server has accepted the request; the task is followed
// to its end by the application root, wherever the user is by then, and its
// progress is shown by the repository's own screen.
export const PublishDialog = ({
  descriptor,
  repository,
  version = null,
  onClose,
  onStarted,
}: Props) => {
  const labelId = useId();
  const { name } = repository;
  const kind = descriptor.publication;
  const options = kind?.options ?? [];
  // What the options hold before the user touches them, kept for the life of
  // the dialog: it is what an option is compared with to tell whether the user
  // changed it.
  const [initial] = useState(() => initialValues(options, repository));
  const [values, setValues] = useState(initial);
  const start = usePublish<PublishBody>(kind?.entity ?? { create: undefined });
  const { watch } = useWatchTask();
  // Pressing Publish twice before the screen has drawn the first press must
  // still send one request.
  const sent = useRef(false);

  if (!kind) {
    return null;
  }

  const failure = start.isError ? saveFailure(start.error, []) : null;
  const number = version?.number;

  const send = async () => {
    if (sent.current) {
      return;
    }
    sent.current = true;

    // The version or the repository, and what the user changed: an option left
    // as it started is left to the server, which takes it from the repository.
    const body: PublishBody = {
      ...(version
        ? { repository_version: version.pulp_href }
        : { repository: repository.pulp_href }),
      ...Object.fromEntries(
        options
          .filter(({ name: option }) => values[option] !== initial[option])
          .map(({ name: option }) => [option, values[option]]),
      ),
    };

    try {
      const task = await start.mutateAsync({
        repository: repository.pulp_href,
        body,
      });
      // The root follows the task to its end wherever the user is by then, and
      // reads the plugin's publications again when it has ended.
      watch({
        href: task,
        label:
          number === undefined
            ? t`Publish of ${name}`
            : t`Publish of version ${number} of ${name}`,
        resource: {
          app: kind.entity.app,
          object: kind.entity.object,
          href: repository.pulp_href,
        },
      });
      onStarted?.(task);
      onClose();
    } catch {
      // The failure is on the mutation and shown in the dialog, which stays
      // open with the options as they were.
    } finally {
      sent.current = false;
    }
  };

  const close = () => {
    if (!start.isPending) {
      onClose();
    }
  };

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={close}
      variant='medium'
      data-cy='PublishDialog'
    >
      <ModalHeader
        labelId={labelId}
        title={
          number === undefined
            ? t`Publish repository "${name}"`
            : t`Publish version ${number} of "${name}"`
        }
      />
      <ModalBody>
        {failure ? (
          <Alert
            isInline
            variant='danger'
            title={t`Failed to publish repository "${name}"`}
          >
            {failure.general}
          </Alert>
        ) : null}
        <Form
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          {options.map((option) => (
            <OptionField
              key={option.name}
              option={option}
              repository={repository}
              value={values[option.name]}
              isDisabled={start.isPending}
              onChange={(value) =>
                setValues((current) => {
                  const next = { ...current, [option.name]: value };
                  return kind.adjust ? kind.adjust(next, option.name) : next;
                })
              }
            />
          ))}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key='publish'
          onClick={send}
          variant='primary'
          isDisabled={start.isPending}
        >
          {t`Publish`}
          {start.isPending ? <Spinner size='sm' /> : null}
        </Button>
        <Button key='close' onClick={close} variant='link'>
          {t`Close`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
