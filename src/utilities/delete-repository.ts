import { failureReason } from './create-repository';
import { parsePulpIDFromURL } from './parse-pulp-id';
import {
  type RepositoryDistributionPlugin,
  repositoryDistributions,
} from './repository-distributions';
import { TaskPending, waitForTaskUrl } from './wait-for-task';

// How many distribution deletes are in flight at once.
export const DELETE_CONCURRENCY = 4;

export interface DeleteRepositoryParams {
  plugin: RepositoryDistributionPlugin;
  RepositoryAPI: { delete: (id: string) => Promise<{ data }> };
  DistributionAPI: { delete: (id: string) => Promise<{ data }> };
  repository: { name: string; pulp_href: string };
  // how long to wait for each task, see waitForTask
  wait?: { bailAfter?: number; multiplier?: number; waitMs?: number };
}

export interface DeleteRepositoryResult {
  // names of the distributions that were removed
  removed: string[];
  // distributions whose delete was refused or failed, with the server's reason
  failed: { name: string; reason: string }[];
  // distributions whose delete task had not finished when the wait gave up
  pending: { name: string; taskHref: string }[];
  repositoryDeleted: boolean;
  // why the repository delete was refused or failed, once every distribution
  // was removed; null otherwise
  repositoryError: string | null;
  // href of the repository delete task when it had not finished when the wait
  // gave up; null otherwise
  repositoryPending: string | null;
}

type DistributionOutcome =
  | { name: string; status: 'removed' }
  | { name: string; status: 'failed'; reason: string }
  | { name: string; status: 'pending'; taskHref: string };

// Runs the jobs with at most `limit` in flight at once. A job must not reject.
async function runBounded<T, R>(
  items: T[],
  limit: number,
  job: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await job(items[index]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

// Sends a delete and waits for its task. Resolves when the object is gone,
// rejects with the refusal or the task failure, and with a TaskPending when the
// task is still running after the wait.
async function deleteAndWait(
  remove: () => Promise<{ data }>,
  wait: DeleteRepositoryParams['wait'],
) {
  const { data } = await remove();
  if (data?.task) {
    await waitForTaskUrl(data.task, wait);
  }
}

// Removes a repository together with every distribution that serves it. The
// distributions of the repository are looked up in full, so none is missed or
// left pointing at a repository that no longer exists, and they are removed
// first. The repository is removed only once every one of them is gone: a
// listing that failed, a delete that was refused or failed, or a task still
// running keeps the repository, and the result says what happened to each
// distribution. A listing error rejects before anything is deleted.
export async function deleteRepositoryWithDistributions({
  plugin,
  RepositoryAPI,
  DistributionAPI,
  repository,
  wait,
}: DeleteRepositoryParams): Promise<DeleteRepositoryResult> {
  const distributions = await repositoryDistributions(
    plugin,
    repository.pulp_href,
    { complete: true },
  );

  const outcomes = await runBounded(
    distributions,
    DELETE_CONCURRENCY,
    async ({ name, pulp_href }): Promise<DistributionOutcome> => {
      try {
        await deleteAndWait(
          () => DistributionAPI.delete(parsePulpIDFromURL(pulp_href)),
          wait,
        );
        return { name, status: 'removed' };
      } catch (e) {
        return e instanceof TaskPending
          ? { name, status: 'pending', taskHref: e.taskHref }
          : { name, status: 'failed', reason: failureReason(e) };
      }
    },
  );

  const result: DeleteRepositoryResult = {
    removed: [],
    failed: [],
    pending: [],
    repositoryDeleted: false,
    repositoryError: null,
    repositoryPending: null,
  };

  outcomes.forEach((outcome) => {
    if (outcome.status === 'removed') {
      result.removed.push(outcome.name);
    } else if (outcome.status === 'failed') {
      result.failed.push({ name: outcome.name, reason: outcome.reason });
    } else {
      result.pending.push({ name: outcome.name, taskHref: outcome.taskHref });
    }
  });

  if (result.failed.length || result.pending.length) {
    return result;
  }

  try {
    await deleteAndWait(
      () => RepositoryAPI.delete(parsePulpIDFromURL(repository.pulp_href)),
      wait,
    );
    result.repositoryDeleted = true;
  } catch (e) {
    if (e instanceof TaskPending) {
      result.repositoryPending = e.taskHref;
    } else {
      result.repositoryError = failureReason(e);
    }
  }

  return result;
}
