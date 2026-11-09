import { t } from '@lingui/core/macro';
import { taskAlert } from '../utilities/task-alert';
import {
  TaskPending,
  TaskUnknown,
  waitForTaskUrl,
} from '../utilities/wait-for-task';

// Follows the task of a change to a repository's content and loads the
// repository page again once the task is done, so the page and its lists show
// the new latest version. A failed task is passed to `failed`. A task that is
// still running, or whose status cannot be read, raises a warning and leaves
// the page as it is, because reloading then would show the old content as if
// the change had not happened.
export async function reloadAfterContentTask(
  task: string,
  {
    addAlert,
    failed,
    reloadPage,
    repositoryName,
  }: {
    addAlert: (alert) => void;
    failed: (error) => void;
    reloadPage: () => void;
    repositoryName: string;
  },
) {
  try {
    await waitForTaskUrl(task);
  } catch (e) {
    if (e instanceof TaskUnknown) {
      addAlert(
        taskAlert(
          e.taskHref,
          t`The outcome of the change to repository "${repositoryName}" is unknown, because the task status could not be read. Check the task.`,
          'warning',
        ),
      );
    } else if (e instanceof TaskPending) {
      addAlert(
        taskAlert(
          e.taskHref,
          t`The change to repository "${repositoryName}" is still running.`,
          'warning',
        ),
      );
    } else {
      failed(e);
    }
    return;
  }

  reloadPage();
}
