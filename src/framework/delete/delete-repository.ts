import type { DistributionBase } from 'src/entities/plugin/distribution';
import { distributionsOfRepository } from 'src/entities/plugin/distribution';
import type { PublicationBase } from 'src/entities/plugin/publication';
import type { Options } from 'src/entities/plugin/request';
import { isSessionEnd } from 'src/utilities/request-error';
import { BULK_CONCURRENCY, runBounded } from '../bulk/run-bounded';
import { failureReason } from '../form/create-flow';
import { TASK_POLL_MS, type TaskEnd, readTaskToEnd } from '../task-end';

// Removes a repository together with the distributions that serve it and that
// the user was shown, on the entities of the plugin. The distributions are
// removed first and the repository only once every one of them is gone: a
// delete that was refused or failed, a task that is still running or cannot be
// read, a distribution that was not shown, or a session that ended keeps the
// repository, and the result says what happened to each distribution.

// Nothing was sent: the distributions of the repository could not be listed.
// It is the only rejection of deleteRepositoryWithDistributions a caller may
// report as "nothing was deleted"; any other rejection happened after deletes
// may have been sent. `cause` is the error of the listing.
export class DeleteNotStarted extends Error {
  cause: unknown;

  constructor(cause: unknown) {
    super('The distributions of the repository could not be listed.');
    Object.setPrototypeOf(this, DeleteNotStarted.prototype);
    this.name = 'DeleteNotStarted';
    this.cause = cause;
  }
}

export interface DeleteRepositoryResult {
  // names of the distributions that were removed
  removed: string[];
  // distributions whose delete was refused or failed, with the server's reason
  failed: { name: string; reason: string }[];
  // distributions whose delete task had not finished when the wait was ended
  pending: { name: string; taskHref: string }[];
  // distributions whose delete was accepted but whose task status could not be
  // read, so it is not known whether they are gone
  unknown: { name: string; taskHref: string }[];
  // names of distributions that serve the repository now but were not among
  // the ones shown, so they were not deleted
  unlisted: string[];
  // distributions whose delete the end of the session left unconfirmed
  unconfirmed: string[];
  // distributions that were never sent because the session had ended
  notSent: string[];
  repositoryDeleted: boolean;
  // why the repository delete was refused or failed, once every distribution
  // was removed; null otherwise
  repositoryError: string | null;
  // href of the repository delete task when it had not finished when the wait
  // was ended; null otherwise
  repositoryPending: string | null;
  // href of the repository delete task when its status could not be read;
  // null otherwise
  repositoryUnknown: string | null;
  // the session ended while the repository was deleted, so nothing is known
  // about it
  repositoryUnconfirmed: boolean;
}

// What the delete needs of the plugin's entities.
export interface DeleteRepositoryParams {
  repository: {
    remove: (href: string, options?: Options) => Promise<string>;
  };
  // The plugin's distributions; absent for a plugin that has none.
  distribution?: {
    index: (options?: Options) => Promise<DistributionBase[]>;
    remove: (href: string, options?: Options) => Promise<string>;
  };
  // The plugin's publications, for a plugin whose distributions can be bound
  // to one.
  publication?: {
    entity: {
      ofRepository: (
        repository: string,
        options?: Options,
      ) => Promise<PublicationBase[]>;
    };
  };
  target: { name: string; pulp_href: string };
  // the distributions the user was shown and confirmed; exactly these are
  // deleted, and only while they still serve the repository
  shown: { name: string; pulp_href: string }[];
  // Ends the waits for the tasks, for a screen that stops waiting on purpose.
  // Leaving the screen is not such a case: the delete goes on and reports
  // what became of it.
  signal?: AbortSignal;
  // How often a task that has not finished is read again.
  pollMs?: number;
}

type DistributionOutcome =
  | { name: string; status: 'removed' }
  | { name: string; status: 'failed'; reason: string }
  | { name: string; status: 'pending'; taskHref: string }
  | { name: string; status: 'unknown'; taskHref: string }
  | { name: string; status: 'unconfirmed' }
  | { name: string; status: 'not-sent' };

// Every distribution that serves the repository now, read from the server and
// not from what a screen holds, so none is missed or left pointing at a
// repository that no longer exists. The publications of the repository are read
// only when some distribution is bound to a publication.
async function servingNow({
  distribution,
  publication,
  target,
  signal,
}: DeleteRepositoryParams): Promise<DistributionBase[]> {
  if (!distribution) {
    return [];
  }
  try {
    const rows = await distribution.index({ signal });
    const publications =
      publication && rows.some((row) => row.publication)
        ? await publication.entity.ofRepository(target.pulp_href, { signal })
        : [];
    const known = new Map(
      publications.map(({ pulp_href }) => [pulp_href, target.pulp_href]),
    );

    return distributionsOfRepository(rows, known, target.pulp_href);
  } catch (error) {
    throw new DeleteNotStarted(error);
  }
}

// Sends a delete and waits for its task to end. The signal ends the wait only:
// a request that is already on its way is never cut off, because nobody could
// then say whether the object was deleted.
async function removeAndWait(
  remove: () => Promise<string>,
  {
    signal,
    pollMs = TASK_POLL_MS,
  }: Pick<DeleteRepositoryParams, 'signal' | 'pollMs'>,
): Promise<{ task: string; end: TaskEnd }> {
  const task = await remove();
  return { task, end: await readTaskToEnd(task, { signal, pollMs }) };
}

export async function deleteRepositoryWithDistributions(
  params: DeleteRepositoryParams,
): Promise<DeleteRepositoryResult> {
  const { repository, distribution, target, shown } = params;
  const serving = await servingNow(params);

  // The listing is read again now, so a distribution that no longer serves the
  // repository is left alone, and one that was created or pointed at the
  // repository since the dialog listed them is reported instead of deleted
  // without the user having seen it.
  const shownHrefs = new Set(shown.map(({ pulp_href }) => pulp_href));
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name);
  const toDelete = serving
    .filter(({ pulp_href }) => shownHrefs.has(pulp_href))
    .sort(byName);
  const unlisted = serving
    .filter(({ pulp_href }) => !shownHrefs.has(pulp_href))
    .sort(byName)
    .map(({ name }) => name);

  // Once the session has ended no further request is sent: the sign-in dialog
  // explains it, and the result says what was done before.
  let sessionEnded = false;
  const outcomes = await runBounded(
    toDelete,
    BULK_CONCURRENCY,
    async ({ name, pulp_href }): Promise<DistributionOutcome> => {
      if (sessionEnded) {
        return { name, status: 'not-sent' };
      }
      try {
        const { task, end } = await removeAndWait(
          () =>
            (distribution as NonNullable<typeof distribution>).remove(
              pulp_href,
            ),
          params,
        );
        switch (end.state) {
          case 'completed':
            return { name, status: 'removed' };
          case 'failed':
            return { name, status: 'failed', reason: end.reason };
          case 'pending':
            return { name, status: 'pending', taskHref: task };
          case 'unknown':
            return { name, status: 'unknown', taskHref: task };
          default:
            sessionEnded = true;
            return { name, status: 'unconfirmed' };
        }
      } catch (error) {
        if (isSessionEnd(error)) {
          sessionEnded = true;
          return { name, status: 'unconfirmed' };
        }
        return { name, status: 'failed', reason: failureReason(error) };
      }
    },
  );

  const result: DeleteRepositoryResult = {
    removed: [],
    failed: [],
    pending: [],
    unknown: [],
    unlisted,
    unconfirmed: [],
    notSent: [],
    repositoryDeleted: false,
    repositoryError: null,
    repositoryPending: null,
    repositoryUnknown: null,
    repositoryUnconfirmed: false,
  };

  for (const outcome of outcomes) {
    switch (outcome.status) {
      case 'removed':
        result.removed.push(outcome.name);
        break;
      case 'failed':
        result.failed.push({ name: outcome.name, reason: outcome.reason });
        break;
      case 'pending':
        result.pending.push({
          name: outcome.name,
          taskHref: outcome.taskHref,
        });
        break;
      case 'unknown':
        result.unknown.push({
          name: outcome.name,
          taskHref: outcome.taskHref,
        });
        break;
      case 'unconfirmed':
        result.unconfirmed.push(outcome.name);
        break;
      default:
        result.notSent.push(outcome.name);
    }
  }

  if (
    result.failed.length ||
    result.pending.length ||
    result.unknown.length ||
    result.unlisted.length ||
    result.unconfirmed.length ||
    result.notSent.length
  ) {
    return result;
  }

  try {
    const { task, end } = await removeAndWait(
      () => repository.remove(target.pulp_href),
      params,
    );
    switch (end.state) {
      case 'completed':
        result.repositoryDeleted = true;
        break;
      case 'failed':
        result.repositoryError = end.reason;
        break;
      case 'pending':
        result.repositoryPending = task;
        break;
      case 'unknown':
        result.repositoryUnknown = task;
        break;
      default:
        result.repositoryUnconfirmed = true;
    }
  } catch (error) {
    if (isSessionEnd(error)) {
      result.repositoryUnconfirmed = true;
    } else {
      result.repositoryError = failureReason(error);
    }
  }

  return result;
}
