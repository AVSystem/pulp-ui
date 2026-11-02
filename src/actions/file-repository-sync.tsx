import { msg, t } from '@lingui/core/macro';
import { FileRepositoryAPI } from '../api/file-repository';
import { SyncModal } from '../components/sync-modal';
import { handleHttpError } from '../utilities/fail-alerts';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { taskAlert } from '../utilities/task-alert';
import { Action } from './action';

export const fileRepositorySyncAction = Action({
  title: msg`Sync`,
  modal: ({ addAlert, query, setState, state }) =>
    state.syncModalOpen ? (
      <SyncModal
        closeAction={() => setState({ syncModalOpen: null })}
        defaultMirror={!state.syncModalOpen.autopublish}
        mirrorLockedReason={
          state.syncModalOpen.autopublish
            ? t`Mirroring cannot be combined with autopublish, so this sync only adds missing content.`
            : undefined
        }
        plugin='file'
        repositoryHref={state.syncModalOpen.pulp_href}
        syncAction={(syncParams) =>
          syncRepository(state.syncModalOpen, { addAlert, query }, syncParams)
        }
        name={state.syncModalOpen.name}
      />
    ) : null,
  onClick: ({ autopublish, name, pulp_href }, { setState }) =>
    setState({
      syncModalOpen: { autopublish: !!autopublish, name, pulp_href },
    }),
  visible: (_item, { hasPermission }) =>
    hasPermission('file.change_collectionremote'),
  disabled: ({ remote }) => {
    if (!remote) {
      return t`There are no remotes associated with this repository.`;
    }
  },
});

function syncRepository(
  { autopublish, name, pulp_href },
  { addAlert, query },
  syncParams,
) {
  const pulpId = parsePulpIDFromURL(pulp_href);
  // pulp_file refuses a mirror sync of a repository that autopublishes.
  return FileRepositoryAPI.sync(pulpId, syncParams || { mirror: !autopublish })
    .then(({ data }) => {
      addAlert(taskAlert(data.task, t`Sync started for repository "${name}".`));

      query();
    })
    .catch(
      handleHttpError(
        t`Failed to sync repository "${name}"`,
        () => null,
        addAlert,
      ),
    );
}
