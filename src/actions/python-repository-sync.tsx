import { msg, t } from '@lingui/core/macro';
import { PythonRepositoryAPI } from 'src/api';
import { SyncModal } from 'src/components';
import {
  handleDialogWriteError,
  parsePulpIDFromURL,
  taskAlert,
} from 'src/utilities';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { Action } from './action';

// pulp_python syncs additively unless mirror is requested. Mirroring deletes
// local content the remote no longer has, so it is the direction to opt into
// rather than out of, as for deb.
const MIRROR_BY_DEFAULT = false;

export const pythonRepositorySyncAction = Action({
  title: msg`Sync`,
  permission: ACTION_PERMISSIONS.python.repository.sync,
  modal: ({ addAlert, query, setState, state }) =>
    state.syncModalOpen ? (
      <SyncModal
        closeAction={() => setState({ syncModalOpen: null })}
        defaultMirror={MIRROR_BY_DEFAULT}
        showOptimize={false}
        plugin='python'
        repositoryHref={state.syncModalOpen.pulp_href}
        syncAction={(syncParams) =>
          syncRepository(state.syncModalOpen, { addAlert, query }, syncParams)
        }
        name={state.syncModalOpen.name}
      />
    ) : null,
  onClick: ({ name, pulp_href }, { setState }) =>
    setState({
      syncModalOpen: { name, pulp_href },
    }),
  disabled: ({ remote }) => {
    if (!remote) {
      return t`There are no remotes associated with this repository.`;
    }
  },
});

function syncRepository({ name, pulp_href }, { addAlert, query }, syncParams) {
  const pulpId = parsePulpIDFromURL(pulp_href);
  return PythonRepositoryAPI.sync(pulpId, {
    mirror: syncParams?.mirror ?? MIRROR_BY_DEFAULT,
  })
    .then(({ data }) => {
      addAlert(taskAlert(data.task, t`Sync started for repository "${name}".`));

      query();
    })
    .catch(
      handleDialogWriteError(
        t`Failed to sync repository "${name}"`,
        () => null,
        addAlert,
      ),
    );
}
