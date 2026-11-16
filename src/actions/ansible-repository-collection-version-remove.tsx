import { msg, t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import { Content } from '@patternfly/react-core';
import { useState } from 'react';
import { AnsibleRepositoryAPI } from '../api/ansible-repository';
import { DeleteModal } from '../components/delete-modal';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { handleHttpError } from '../utilities/fail-alerts';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { isSessionEnd } from '../utilities/request-error';
import { taskAlert } from '../utilities/task-alert';
import { Action } from './action';
import { reloadAfterContentTask } from './repository-content-task';

// Removes the collection version from the repository, then reloads the page
// once the task is done so the tab lists the new latest version. A request
// that did not go through because the session ended leaves the dialog open,
// and nothing is sent again by itself.
async function remove(
  {
    collection: { namespace, name, version },
    collectionVersionHref,
    repositoryHref,
    repositoryName,
  },
  { addAlert, setState, reloadPage },
) {
  const pulpId = parsePulpIDFromURL(repositoryHref);
  const failed = handleHttpError(
    t`Failed to remove ${namespace}.${name} v${version} from repository "${repositoryName}".`,
    () => setState((ms) => ({ ...ms, removeCollectionVersionModal: null })),
    addAlert,
  );

  let task;
  try {
    ({
      data: { task },
    } = await AnsibleRepositoryAPI.removeContent(
      pulpId,
      collectionVersionHref,
    ));
  } catch (e) {
    if (!isSessionEnd(e)) {
      failed(e);
    }
    return;
  }

  addAlert(
    taskAlert(
      task,
      t`Removal of ${namespace}.${name} v${version} from repository "${repositoryName}" started.`,
    ),
  );
  setState((ms) => ({ ...ms, removeCollectionVersionModal: null }));

  await reloadAfterContentTask(task, {
    addAlert,
    failed,
    reloadPage,
    repositoryName,
  });
}

const RemoveCollectionVersionModal = ({
  name,
  namespace,
  repositoryName,
  version,
  closeAction,
  deleteAction,
}: {
  closeAction: () => void;
  deleteAction: () => Promise<void>;
  name: string;
  namespace: string;
  repositoryName: string;
  version: string;
}) => {
  // set while the remove request runs, so a second click cannot send it again
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
        deleteAction().finally(() => setPending(false));
      }}
      isDisabled={pending}
      isRemove
      title={t`Remove collection version?`}
    >
      <Content component='p'>
        <Trans>
          Are you sure you want to remove the collection version{' '}
          <b>
            {namespace}.{name} v{version}
          </b>{' '}
          from the <b>{repositoryName}</b> repository?
        </Trans>
      </Content>
    </DeleteModal>
  );
};

export const ansibleRepositoryCollectionVersionRemoveAction = Action({
  title: msg`Remove`,
  permission: ACTION_PERMISSIONS.ansible.repository.modify,
  modal: ({ addAlert, state, setState, reloadPage }) =>
    state.removeCollectionVersionModal ? (
      <RemoveCollectionVersionModal
        closeAction={() =>
          setState((ms) => ({ ...ms, removeCollectionVersionModal: null }))
        }
        deleteAction={() =>
          remove(state.removeCollectionVersionModal, {
            addAlert,
            setState,
            reloadPage,
          })
        }
        name={state.removeCollectionVersionModal.collection.name}
        namespace={state.removeCollectionVersionModal.collection.namespace}
        repositoryName={state.removeCollectionVersionModal.repositoryName}
        version={state.removeCollectionVersionModal.collection.version}
      />
    ) : null,
  onClick: (
    { namespace, name, version, pulp_href: collectionVersionHref },
    {
      state: {
        repository: { name: repositoryName, pulp_href: repositoryHref },
      },
      setState,
    },
  ) =>
    setState((ms) => ({
      ...ms,
      removeCollectionVersionModal: {
        collection: { namespace, name, version },
        repositoryName,
        repositoryHref,
        collectionVersionHref,
      },
    })),
});
