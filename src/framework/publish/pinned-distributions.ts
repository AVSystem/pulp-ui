import { t } from '@lingui/core/macro';
import type {
  DistributionBase,
  DistributionChanges,
  DistributionEntity,
} from 'src/entities/plugin/distribution';
import { bindingChange } from 'src/entities/plugin/distribution';
import {
  type BulkOutcome,
  type BulkResult,
  runBulk,
} from '../bulk/bulk-actions';
import { readTaskToEnd } from '../task-end';

// The distributions of a repository that are bound to one publication and so
// keep serving it when a newer one is made. Publishing does not move them: the
// user chooses which ones follow.

// The distributions bound to a publication made from an older version than the
// one that is being published. `distributions` are the ones that serve the
// repository, `publicationVersions` holds the version number of each
// publication the user can read, by its address. A distribution bound to the
// repository or to a version is not pinned to a publication and is left out, as
// is one whose publication is not known or names no version: nothing can be
// said about it.
export function pinnedToOlder<Row extends DistributionBase>(
  distributions: readonly Row[],
  publicationVersions: ReadonlyMap<string, number | null>,
  version: number,
): Row[] {
  return distributions.filter((row) => {
    if (!row.publication) {
      return false;
    }
    const bound = publicationVersions.get(row.publication);
    return typeof bound === 'number' && bound < version;
  });
}

// What a plugin's distribution entity offers for a move.
type MovingEntity<Row extends DistributionBase> = Pick<
  DistributionEntity<Row, unknown, DistributionChanges>,
  'app' | 'update'
>;

// Makes each distribution serve the publication. A move sends the new binding
// and null for each other binding the plugin's distribution has, because the
// server refuses a change that leaves a distribution bound to two things. The
// moves run four at a time; each one ends with its own outcome, and one that
// fails never stops the others. A move the server runs as a task is followed to
// the end of that task.
export function moveToPublication<Row extends DistributionBase>(
  entity: MovingEntity<Row>,
  distributions: readonly Row[],
  publication: string,
  { signal }: { signal?: AbortSignal },
): Promise<BulkResult<Row>[]> {
  const body = bindingChange(entity.app, { publication });

  return runBulk(distributions, async (row): Promise<BulkOutcome> => {
    const result = await entity.update(row.pulp_href, body);
    if (result.kind === 'done') {
      return { kind: 'succeeded' };
    }
    const end = await readTaskToEnd(result.task, { signal });
    switch (end.state) {
      case 'completed':
        return { kind: 'succeeded' };
      case 'failed':
        return { kind: 'failed', reason: end.reason };
      case 'unconfirmed':
        return { kind: 'unconfirmed' };
      case 'pending':
        return { kind: 'started', task: result.task };
      default:
        return {
          kind: 'failed',
          reason: t`The result of the change could not be read.`,
        };
    }
  });
}
