import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import {
  Button,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Switch,
} from '@patternfly/react-core';
import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, FormFieldHelper, HelpButton, Spinner } from 'src/components';
import { taskUrlId } from 'src/entities/core/task/href';
import type { Task } from 'src/entities/core/task/model';
import { useActiveTaskOf } from 'src/entities/core/task/task-index';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useSyncRepository } from 'src/entities/plugin/queries';
import { Paths, formatPath } from 'src/paths';
import { isSessionEnd } from 'src/utilities/request-error';
import { translateTask } from 'src/utilities/translate-task';
import type { PluginDescriptor, SyncBody, SyncOptionDef } from '../descriptor';
import { saveFailure } from '../form/save-errors';
import { useWatchTask } from '../watched-tasks';

interface Props {
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  // Called when the dialog is to go away: after a sync was accepted, or when
  // the user closes it. It cannot be closed while the request is on its way.
  onClose: () => void;
  // Called once, with the address of the task, when the server has accepted the
  // sync and before the dialog closes.
  onStarted?: (task: string) => void;
}

// What every option holds before the user touches it, from the repository,
// with the options the server would refuse held at the value that is allowed.
export function initialValues(
  options: readonly SyncOptionDef<RepositoryBase>[],
  repository: RepositoryBase,
): Record<string, unknown> {
  return Object.fromEntries(
    options.map((option) => [
      option.name,
      option.fixed?.(repository)?.value ?? option.initial(repository),
    ]),
  );
}

// The dialog that starts a sync of one repository. The options come from the
// plugin's descriptor, the remote from the repository. Before it offers Sync it
// asks once whether the repository already holds a waiting or running task: a
// second sync would only queue behind it, so the dialog says what is there and
// keeps Sync off. A check that failed leaves Sync usable, because the server
// queues the second sync in that case. The dialog closes as soon as the server
// has accepted the request; the progress is shown by the repository's own
// screen, not here.
export const SyncDialog = ({
  descriptor,
  repository,
  onClose,
  onStarted,
}: Props) => {
  const labelId = useId();
  const { name } = repository;
  const { entity, sync } = descriptor.repository;
  const options = sync?.options ?? [];
  const [values, setValues] = useState(() =>
    initialValues(options, repository),
  );
  const start = useSyncRepository(entity);
  const { watch } = useWatchTask();
  // Pressing Sync twice before the screen has drawn the first press must still
  // send one request.
  const sent = useRef(false);

  const active = useActiveTaskOf(repository.pulp_href);
  const found = active.data ?? null;
  const checkFailed = active.isError && !isSessionEnd(active.error);

  if (!sync) {
    return null;
  }

  const failure = start.isError ? saveFailure(start.error, []) : null;

  const send = async () => {
    if (sent.current) {
      return;
    }
    sent.current = true;

    // What the user sees is what is sent: an option held at a value for the
    // repository goes with that value whatever the state says.
    const body: SyncBody = {
      ...(repository.remote ? { remote: repository.remote } : {}),
      ...Object.fromEntries(
        options.map((option) => [
          option.name,
          option.fixed?.(repository)?.value ?? values[option.name],
        ]),
      ),
    };

    try {
      const task = await start.mutateAsync({
        href: repository.pulp_href,
        body,
      });
      // The root follows the task to its end wherever the user is by then.
      watch({
        href: task,
        label: t`Sync of ${name}`,
        resource: {
          app: entity.app,
          object: entity.object,
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
      data-cy='SyncDialog'
    >
      <ModalHeader labelId={labelId} title={t`Sync repository "${name}"`} />
      <ModalBody>
        {found ? (
          <RunningTaskAlert task={found} syncTask={sync.taskName} />
        ) : null}
        {checkFailed ? (
          <Alert
            isInline
            title={t`Could not check whether a sync is already running. You can still start one; it will wait for the running one to finish.`}
            variant='info'
          />
        ) : null}
        {failure ? (
          <Alert
            isInline
            variant='danger'
            title={t`Failed to sync repository "${name}"`}
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
                setValues((current) => ({ ...current, [option.name]: value }))
              }
            />
          ))}
        </Form>
      </ModalBody>
      <ModalFooter>
        <div data-cy='sync-button' key='sync'>
          <Button
            key='sync'
            onClick={send}
            variant='primary'
            isDisabled={start.isPending || !!found}
          >
            {t`Sync`}
            {start.isPending ? <Spinner size='sm' /> : null}
          </Button>
        </div>
        <Button key='close' onClick={close} variant='link'>
          {t`Close`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

interface OptionFieldProps {
  option: SyncOptionDef<RepositoryBase>;
  // The repository the option is held for. A dialog that syncs several
  // repositories passes none and says in `hint` what is held per repository.
  repository?: RepositoryBase;
  hint?: string;
  value: unknown;
  isDisabled: boolean;
  onChange: (value: unknown) => void;
}

// One option of the dialog: a switch, or a choice among the plugin's values. An
// option the server would refuse for this repository shows the value that is
// allowed, cannot be changed, and says why.
export const OptionField = ({
  option,
  repository,
  hint,
  value,
  isDisabled,
  onChange,
}: OptionFieldProps) => {
  const fixed = repository ? (option.fixed?.(repository) ?? null) : null;
  const id = useId();
  const shown = fixed ? fixed.value : value;

  return (
    <FormGroup
      label={i18n._(option.label)}
      fieldId={id}
      labelHelp={
        option.help ? <HelpButton content={i18n._(option.help)} /> : undefined
      }
    >
      {option.kind === 'select' ? (
        <FormSelect
          id={id}
          value={String(shown ?? '')}
          isDisabled={isDisabled || !!fixed}
          onChange={(_event, chosen) => onChange(chosen)}
        >
          {(option.options ?? []).map(({ value: choice, label }) => (
            <FormSelectOption
              key={choice}
              value={choice}
              label={i18n._(label)}
            />
          ))}
        </FormSelect>
      ) : (
        <Switch
          id={id}
          isChecked={shown === true}
          isDisabled={isDisabled || !!fixed}
          onChange={(_event, checked) => onChange(checked)}
          label={option.boxLabel ? i18n._(option.boxLabel) : undefined}
        />
      )}
      {fixed ? <FormFieldHelper>{fixed.reason}</FormFieldHelper> : null}
      {hint ? <FormFieldHelper>{hint}</FormFieldHelper> : null}
    </FormGroup>
  );
};

// What the repository already holds: a sync of its own plugin, or another task
// that keeps the repository busy, queued or running, with a link to it.
const RunningTaskAlert = ({
  task,
  syncTask,
}: {
  task: Task;
  syncTask: string;
}) => {
  const queued = task.state === 'waiting';
  const shown = { name: translateTask(task.name) };
  let title: string;
  if (task.name === syncTask) {
    title = queued
      ? t`A sync of this repository is already queued.`
      : t`A sync of this repository is already running.`;
  } else {
    title = queued
      ? t`Another task is already queued for this repository: ${shown.name}`
      : t`Another task is already running for this repository: ${shown.name}`;
  }
  const id = taskUrlId(task.pulp_href);

  return (
    <Alert isInline title={title} variant='warning'>
      {id ? (
        <Link
          to={formatPath(Paths.core.task.detail, {
            task: taskUrlId(task.pulp_href),
          })}
        >
          {t`View the task`}
        </Link>
      ) : null}
    </Alert>
  );
};
