import { msg, t } from '@lingui/core/macro';
import { PythonRemoteAPI } from 'src/api';
import { DeleteRemoteModal } from 'src/components';
import {
  handleHttpError,
  parsePulpIDFromURL,
  taskAlert,
  waitForTaskUrl,
} from 'src/utilities';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { TaskPending, TaskUnknown } from '../utilities/wait-for-task';
import { Action } from './action';

export const pythonRemoteDeleteAction = Action({
  title: msg`Delete`,
  permission: ACTION_PERMISSIONS.python.remote.delete,
  modal: ({ addAlert, listQuery, setState, state }) =>
    state.deleteModalOpen ? (
      <DeleteRemoteModal
        closeAction={() => setState({ deleteModalOpen: null })}
        deleteAction={() =>
          deleteRemote(state.deleteModalOpen, { addAlert, setState, listQuery })
        }
        name={state.deleteModalOpen.name}
      />
    ) : null,
  onClick: (
    { name, id, pulp_href }: { name: string; id?: string; pulp_href?: string },
    { setState },
  ) =>
    setState({
      deleteModalOpen: { pulpId: id || parsePulpIDFromURL(pulp_href), name },
    }),
});

function deleteRemote({ name, pulpId }, { addAlert, setState, listQuery }) {
  return PythonRemoteAPI.delete(pulpId)
    .then(({ data }) => {
      addAlert(taskAlert(data.task, t`Removal started for remote ${name}`));
      setState({ deleteModalOpen: null });
      return waitForTaskUrl(data.task);
    })
    .then(() => listQuery())
    .catch((e) => {
      if (e instanceof TaskUnknown) {
        // the request was accepted and the removal may well have been done
        addAlert(
          taskAlert(
            e.taskHref,
            t`The outcome of removing remote ${name} is unknown, because the task status could not be read. Check the task.`,
            'warning',
          ),
        );
        listQuery();
      } else if (e instanceof TaskPending) {
        // the task may still complete: it is not reported as failed
        addAlert(
          taskAlert(
            e.taskHref,
            t`The removal of remote ${name} is still running.`,
            'warning',
          ),
        );
        listQuery();
      } else {
        handleHttpError(
          t`Failed to remove remote ${name}`,
          () => null,
          addAlert,
        )(e);
      }
    });
}
