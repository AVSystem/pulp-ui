import { t } from '@lingui/core/macro';
import { type DeleteLabels, useDeleteRemote } from '../delete/delete-remote';

// The one way a distribution of any plugin is deleted, from a row of a list or
// from its own screen. It is the delete of a remote, worded for a
// distribution: the delete is sent once, the server answers with the task that
// does the work, and the application root follows it to its end wherever the
// user is by then.
const DISTRIBUTION_LABELS: DeleteLabels = {
  removal: (name) => t`Removal of distribution ${name}`,
  started: (name) => t`Removal started for distribution ${name}`,
};

export function useDeleteDistribution(entity: {
  readonly app: string;
  readonly object: string;
  remove: (href: string, options?: RequestInit) => Promise<string>;
}) {
  return useDeleteRemote(entity, DISTRIBUTION_LABELS);
}
