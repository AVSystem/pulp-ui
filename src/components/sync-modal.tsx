import { t } from '@lingui/core/macro';
import {
  Alert,
  Button,
  FormGroup,
  FormSelect,
  FormSelectOption,
  Modal,
  Switch,
} from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { FormFieldHelper, HelpButton, Spinner } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import {
  type IRunningTask,
  type SyncPlugin,
  runningTask,
} from '../utilities/running-sync';

interface IProps {
  closeAction: () => null;
  // Which way the mirror switch starts. Plugins disagree: pulp_deb's API defaults
  // a sync to not mirroring, where ansible and file have always offered to.
  defaultMirror?: boolean;
  // When given, the mirror switch stays off and cannot be turned on, and the
  // text says why; used where the server refuses a mirror sync.
  mirrorLockedReason?: string;
  // With the repository and its plugin the dialog asks, once per opening,
  // whether a sync is already queued or running, and disables Sync while one
  // is. Without them nothing is checked.
  plugin?: SyncPlugin;
  repositoryHref?: string;
  // pulp_python's sync has no optimize option
  showOptimize?: boolean;
  syncAction: (syncParams) => Promise<void>;
  name: string;
  // When given, a sync policy dropdown replaces the mirror switch (pulp_rpm).
  syncPolicies?: { id: string; label: string }[];
  defaultSyncPolicy?: string;
}

// What the check for a running sync found. A failed check leaves Sync usable,
// because the server queues a second sync behind the first.
type RunningCheck =
  | { status: 'pending' }
  | { status: 'idle' }
  | { status: 'failed' }
  | { status: 'found'; task: IRunningTask };

export const SyncModal = ({
  closeAction,
  defaultMirror = true,
  defaultSyncPolicy,
  mirrorLockedReason,
  plugin,
  repositoryHref,
  syncPolicies,
  showOptimize = true,
  syncAction,
  name,
}: IProps) => {
  const [pending, setPending] = useState(false);
  const [syncParams, setSyncParams] = useState({
    mirror: defaultMirror,
    optimize: true,
    sync_policy: defaultSyncPolicy,
  });

  useEffect(() => {
    setPending(false);
    setSyncParams({
      mirror: defaultMirror,
      optimize: true,
      sync_policy: defaultSyncPolicy,
    });
  }, [name, defaultMirror, defaultSyncPolicy]);

  const [check, setCheck] = useState<RunningCheck>({ status: 'pending' });

  useEffect(() => {
    if (!repositoryHref || !plugin) {
      setCheck({ status: 'idle' });
      return;
    }

    // An answer for a repository the dialog has since left must not show.
    let current = true;
    setCheck({ status: 'pending' });
    runningTask(repositoryHref, plugin)
      .then((found) => {
        if (current) {
          setCheck(
            found ? { status: 'found', task: found } : { status: 'idle' },
          );
        }
      })
      .catch(() => {
        if (current) {
          setCheck({ status: 'failed' });
        }
      });

    return () => {
      current = false;
    };
  }, [repositoryHref, plugin]);

  if (!name) {
    return null;
  }

  const found = check.status === 'found' ? check.task : null;

  return (
    <Modal
      actions={[
        <div data-cy='sync-button' key='sync'>
          <Button
            key='sync'
            onClick={() => {
              setPending(true);
              syncAction(
                mirrorLockedReason
                  ? { ...syncParams, mirror: false }
                  : syncParams,
              )
                .then(closeAction)
                .finally(() => setPending(false));
            }}
            variant='primary'
            isDisabled={pending || !!found}
          >
            {t`Sync`}
            {pending && <Spinner size='sm' />}
          </Button>
        </div>,
        <Button key='close' onClick={closeAction} variant='link'>
          {t`Close`}
        </Button>,
      ]}
      isOpen
      onClose={closeAction}
      title={t`Sync repository "${name}"`}
      variant='medium'
    >
      {found && <RunningTaskAlert task={found} />}
      {check.status === 'failed' && (
        <Alert
          isInline
          title={t`Could not check whether a sync is already running. You can still start one; it will wait for the running one to finish.`}
          variant='info'
        />
      )}
      {syncPolicies ? (
        <FormGroup
          label={t`Sync policy`}
          fieldId='sync_policy'
          labelIcon={
            <HelpButton
              content={t`Additive keeps everything already in the repository. Mirror content only removes what the remote no longer has. Mirror complete also reproduces the remote's metadata exactly, which kickstart trees need.`}
            />
          }
        >
          <FormSelect
            id='sync_policy'
            value={syncParams.sync_policy}
            onChange={(_event, sync_policy) =>
              setSyncParams({ ...syncParams, sync_policy })
            }
          >
            {syncPolicies.map(({ id, label }) => (
              <FormSelectOption key={id} value={id} label={label} />
            ))}
          </FormSelect>
        </FormGroup>
      ) : (
        <FormGroup
          label={t`Mirror`}
          labelIcon={
            <HelpButton
              content={t`If selected, all content that is not present in the remote repository will be removed from the local repository; otherwise, sync will add missing content.`}
            />
          }
        >
          <Switch
            isChecked={syncParams.mirror && !mirrorLockedReason}
            isDisabled={!!mirrorLockedReason}
            onChange={(_event, mirror) =>
              setSyncParams({ ...syncParams, mirror })
            }
            label={t`Content not present in remote repository will be removed from the local repository`}
            labelOff={t`Sync will only add missing content`}
          />
          {mirrorLockedReason && (
            <FormFieldHelper>{mirrorLockedReason}</FormFieldHelper>
          )}
        </FormGroup>
      )}
      <br />
      {showOptimize && (
        <>
          <FormGroup
            label={t`Optimize`}
            labelIcon={
              <HelpButton
                content={t`Only perform the sync if changes are reported by the remote server. To force a sync to happen, deselect this option.`}
              />
            }
          >
            <Switch
              isChecked={syncParams.optimize}
              onChange={(_event, optimize) =>
                setSyncParams({ ...syncParams, optimize })
              }
              label={t`Only perform the sync if changes are reported by the remote server.`}
              labelOff={t`Force a sync to happen.`}
            />
          </FormGroup>
          <br />
        </>
      )}
    </Modal>
  );
};

const RunningTaskAlert = ({ task }: { task: IRunningTask }) => {
  const queued = task.state === 'waiting';
  let title: string;
  if (task.isSync) {
    title = queued
      ? t`A sync of this repository is already queued.`
      : t`A sync of this repository is already running.`;
  } else {
    title = queued
      ? t`Another task is already queued for this repository: ${task.name}`
      : t`Another task is already running for this repository: ${task.name}`;
  }

  return (
    <Alert isInline title={title} variant='warning'>
      <Link
        to={formatPath(Paths.core.task.detail, {
          task: parsePulpIDFromURL(task.pulp_href),
        })}
      >
        {t`View the task`}
      </Link>
    </Alert>
  );
};
