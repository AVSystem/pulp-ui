import type {
  DistributionCreate,
  DistributionEntity,
} from 'src/entities/plugin/distribution';
import { distributionCreateBody } from 'src/entities/plugin/distribution';
import {
  type CreateOutcome,
  type DistributionOutcome,
  conflictsOf,
  outcomeOfTask,
} from '../form/create-flow';
import { TASK_POLL_MS } from '../task-end';

// Creates a distribution of one plugin. The name and the base path are checked
// against the distributions of every plugin first, so a conflict stops
// everything before a single write. The task that creates it is read to its end
// and the guard the server really set is read back, so the screen can say what
// protects the distribution instead of what was asked for. Nothing is ever
// retried, with the same or with another name or base path.
export type CreateDistributionOutcome =
  | Extract<CreateOutcome, { kind: 'blocked' }>
  | { kind: 'created'; distribution: DistributionOutcome };

interface Params {
  entity: Pick<DistributionEntity<never, DistributionCreate, never>, 'create'>;
  // The body as the form built it: `content_guard` is null only for the
  // explicit Public choice and absent when the server manages the guard.
  body: DistributionCreate;
  // Ends the wait for the task, for a screen that is left before the task has
  // finished.
  signal?: AbortSignal;
  pollMs?: number;
}

export async function createDistribution({
  entity,
  body,
  signal,
  pollMs = TASK_POLL_MS,
}: Params): Promise<CreateDistributionOutcome> {
  const blocked = await conflictsOf(body.name, body.base_path);
  if (blocked) {
    return blocked;
  }

  // A failure here leaves nothing behind and is thrown for the form to show.
  const task = await entity.create(distributionCreateBody(body));

  return {
    kind: 'created',
    distribution: await outcomeOfTask(
      task,
      body.content_guard ?? null,
      signal,
      pollMs,
    ),
  };
}
