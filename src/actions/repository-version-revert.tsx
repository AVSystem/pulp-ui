import { msg, t } from '@lingui/core/macro';
import { Button, Modal } from '@patternfly/react-core';
import { useState } from 'react';
import { Spinner } from '../components/patternfly-wrappers/l10n';
import { handleHttpError } from '../utilities/fail-alerts';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { taskAlert } from '../utilities/task-alert';
import { TaskPending, waitForTaskUrl } from '../utilities/wait-for-task';
import { Action } from './action';

// What the action needs of a plugin's repository API: a request that makes a
// new latest version out of an existing one.
interface RevertAPI {
  revert: (id: string, versionHref: string) => Promise<{ data: { task } }>;
}

const RevertModal = ({
  version,
  cancelAction,
  revertAction,
}: {
  version: number;
  cancelAction: () => void;
  revertAction: () => void;
}) => {
  const [pending, setPending] = useState(false);

  return (
    <Modal
      actions={[
        <Button
          key='revert'
          onClick={() => {
            setPending(true);
            revertAction();
          }}
          variant='danger'
          isDisabled={pending}
        >
          {t`Revert`}
          {pending && <Spinner size='sm' />}
        </Button>,
        <Button key='cancel' onClick={cancelAction} variant='link'>
          {t`Cancel`}
        </Button>,
      ]}
      isOpen
      onClose={cancelAction}
      title={t`Revert repository`}
      titleIconVariant='warning'
      variant={'small'}
    >
      {t`Are you sure you want to revert this repository to the version below?`}
      <br />
      <b>{version}</b>
    </Modal>
  );
};

// The "Revert to this version" action of a repository versions list. The
// server creates a new latest version with the content of the chosen one; no
// version and no content is deleted. The list's action context must carry
// `reloadPage`, which loads the repository again once the task is done so the
// new latest version shows.
export const repositoryVersionRevertAction = (RepositoryAPI: RevertAPI) => {
  async function revert(
    { repositoryName, pulp_href, number },
    { addAlert, setState, reloadPage },
  ) {
    // the first uuid of a version href is the repository's
    const repositoryId = parsePulpIDFromURL(pulp_href);
    const failed = handleHttpError(
      t`Failed to revert repository "${repositoryName}" to version "${number}"`,
      () => setState({ revertModal: null }),
      addAlert,
    );

    let task;
    try {
      ({
        data: { task },
      } = await RepositoryAPI.revert(repositoryId, pulp_href));
    } catch (e) {
      failed(e);
      return;
    }

    addAlert(
      taskAlert(task, t`Revert started for repository "${repositoryName}".`),
    );
    setState({ revertModal: null });

    try {
      await waitForTaskUrl(task);
    } catch (e) {
      if (e instanceof TaskPending) {
        // the task may still complete: it is neither reported as failed nor
        // is the page reloaded behind it
        addAlert(
          taskAlert(
            e.taskHref,
            t`The revert of repository "${repositoryName}" is still running.`,
            'warning',
          ),
        );
      } else {
        failed(e);
      }
      return;
    }

    addAlert({
      variant: 'success',
      title: t`Reverted repository "${repositoryName}" to version "${number}".`,
    });
    reloadPage();
  }

  return Action({
    title: msg`Revert to this version`,
    modal: ({ addAlert, state, setState, reloadPage }) =>
      state.revertModal ? (
        <RevertModal
          cancelAction={() => setState({ revertModal: null })}
          revertAction={() =>
            revert(state.revertModal, { addAlert, setState, reloadPage })
          }
          version={state.revertModal.number}
        />
      ) : null,
    onClick: ({ repositoryName, number, pulp_href }, { setState }) =>
      setState({ revertModal: { repositoryName, number, pulp_href } }),
    disabled: ({ isLatest }) => {
      if (isLatest) {
        return t`Already the current version`;
      }

      return null;
    },
  });
};
