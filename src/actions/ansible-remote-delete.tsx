import { msg, t } from '@lingui/core/macro';
import { AnsibleRemoteAPI } from '../api/ansible-remote';
import { DeleteRemoteModal } from '../components/delete-remote-modal';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { handleHttpError } from '../utilities/fail-alerts';
import { taskAlert } from '../utilities/task-alert';
import {
  TaskPending,
  TaskUnknown,
  waitForTaskUrl,
} from '../utilities/wait-for-task';
import { Action } from './action';

export const ansibleRemoteDeleteAction = Action({
  title: msg`Delete`,
  permission: ACTION_PERMISSIONS.ansible.remote.delete,
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
    { name, pulp_href }: { name: string; pulp_href?: string },
    { setState },
  ) => setState({ deleteModalOpen: { pulp_href, name } }),
});

function deleteRemote({ name, pulp_href }, { addAlert, setState, listQuery }) {
  return AnsibleRemoteAPI.delete(pulp_href)
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
