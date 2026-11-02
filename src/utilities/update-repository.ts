import { t } from '@lingui/core/macro';
import { type AlertType } from 'src/components/alert-list';
import { changedFields } from './changed-fields';
import { parsePulpIDFromURL } from './parse-pulp-id';
import { taskAlert } from './task-alert';

interface PatchRepositoryParams {
  RepositoryAPI: { patch: (id: string, data) => Promise<{ data }> };
  // the repository as the server returned it when the page loaded
  item: { name: string; pulp_href: string };
  // the same repository with the user's edits applied
  edited: Record<string, unknown>;
}

// Saves an edit by sending only the fields the user changed, so a field that
// someone else changed meanwhile is not overwritten with a stale value. An edit
// that changes nothing sends no request. Returns the alert to show: the server
// answers with a task when something changed, and with the repository itself
// when it did not.
export async function patchRepository({
  RepositoryAPI,
  item,
  edited,
}: PatchRepositoryParams): Promise<AlertType> {
  const { name } = item;
  const changes = changedFields(item, edited);

  if (!Object.keys(changes).length) {
    return {
      variant: 'info',
      title: t`Nothing changed in repository ${name}.`,
    };
  }

  const { data: task } = await RepositoryAPI.patch(
    parsePulpIDFromURL(item.pulp_href),
    changes,
  );

  return task?.task
    ? taskAlert(task, t`Update started for repository ${name}`)
    : { variant: 'success', title: t`Updated repository ${name}` };
}
