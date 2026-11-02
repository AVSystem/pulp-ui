import { TaskAPI } from '../api/task';

export type SyncPlugin = 'deb' | 'file' | 'python' | 'rpm';

// The task each plugin runs for a sync. A task with another name is still
// reported to the user, only worded as a different kind of task.
const SYNC_TASK_NAMES: Record<SyncPlugin, string> = {
  deb: 'pulp_deb.app.tasks.synchronizing.synchronize',
  file: 'pulp_file.app.tasks.synchronizing.synchronize',
  python: 'pulp_python.app.tasks.sync.sync',
  rpm: 'pulp_rpm.app.tasks.synchronizing.synchronize',
};

export const isSyncTask = (plugin: SyncPlugin, taskName: string): boolean =>
  SYNC_TASK_NAMES[plugin] === taskName;

export interface IRunningTask {
  pulp_href: string;
  name: string;
  state: string;
  // whether the task is the plugin's sync task
  isSync: boolean;
}

// The oldest task that is waiting or running and holds the repository
// exclusively, or null. A sync reserves its repository exclusively, so such a
// task delays any new sync. Only the task list is read; a failed request
// rejects and the caller decides what that means.
export async function runningTask(
  repositoryHref: string,
  plugin: SyncPlugin,
): Promise<IRunningTask | null> {
  const {
    data: { results },
  } = await TaskAPI.list({
    exclusive_resources: repositoryHref,
    ordering: 'pulp_created',
    page_size: 1,
    state__in: 'waiting,running',
  });

  const [found] = results;
  if (!found) {
    return null;
  }

  return {
    pulp_href: found.pulp_href,
    name: found.name,
    state: found.state,
    isSync: isSyncTask(plugin, found.name),
  };
}
