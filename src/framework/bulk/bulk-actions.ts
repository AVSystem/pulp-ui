import { t } from '@lingui/core/macro';
import type {
  PublicationBase,
  PublicationEntity,
} from 'src/entities/plugin/publication';
import { isSessionEnd } from 'src/utilities/request-error';
import {
  DeleteNotStarted,
  type DeleteRepositoryParams,
  type DeleteRepositoryResult,
  deleteRepositoryWithDistributions,
  readServingSnapshot,
} from '../delete/delete-repository';
import { failureReason } from '../form/create-flow';
import { BULK_CONCURRENCY, runBounded } from './run-bounded';

// The work of the bulk actions on selected rows. Every action runs one job per
// row with at most BULK_CONCURRENCY in flight and answers with one outcome per
// row, whatever happened to the others: a row that cannot be handled never
// stops the rest, and no function here rejects for one row's failure.

// A row of a bulk action: the name the user knows it by and the address the
// requests go to.
export interface BulkTarget {
  name: string;
  pulp_href: string;
}

// What became of one row.
export type BulkOutcome =
  // done
  | { kind: 'succeeded'; note?: string }
  // the server accepted the work and started a task that does it
  | { kind: 'started'; task: string; note?: string }
  // nothing was sent because there was nothing to do, with the reason
  | { kind: 'skipped'; reason: string }
  // refused or failed, with the server's reason
  | { kind: 'failed'; reason: string }
  // nothing was sent because the session had ended
  | { kind: 'not-sent' }
  // the session ended while the request was on its way, so it is not known
  // whether it was carried out
  | { kind: 'unconfirmed' };

export interface BulkResult<Row extends BulkTarget = BulkTarget> {
  target: Row;
  outcome: BulkOutcome;
}

// Called as each row settles, for a screen that shows the progress.
export type OnSettled<Row extends BulkTarget = BulkTarget> = (
  result: BulkResult<Row>,
) => void;

function outcomeOfError(error: unknown): BulkOutcome {
  return isSessionEnd(error)
    ? { kind: 'unconfirmed' }
    : { kind: 'failed', reason: failureReason(error) };
}

// Runs the job for every row, four at a time. A job that throws is a failure of
// its row; once the session has ended no further request is sent, and the rows
// that were not reached say so.
export async function runBulk<Row extends BulkTarget>(
  rows: readonly Row[],
  job: (row: Row) => Promise<BulkOutcome>,
  onSettled?: OnSettled<Row>,
): Promise<BulkResult<Row>[]> {
  let sessionEnded = false;

  return runBounded(rows, BULK_CONCURRENCY, async (target) => {
    let outcome: BulkOutcome;
    if (sessionEnded) {
      outcome = { kind: 'not-sent' };
    } else {
      try {
        outcome = await job(target);
      } catch (error) {
        outcome = outcomeOfError(error);
      }
      if (outcome.kind === 'unconfirmed') {
        sessionEnded = true;
      }
    }
    const result = { target, outcome };
    onSettled?.(result);
    return result;
  });
}

// What a bulk delete of repositories needs of the plugin: the entities of
// DeleteRepositoryParams, and what the user was shown for each repository.
export interface BulkDeleteParams extends Pick<
  DeleteRepositoryParams,
  'repository' | 'distribution'
> {
  publication?: {
    entity: Pick<
      PublicationEntity<PublicationBase>,
      'chunks' | 'ofHrefs' | 'ofRepository'
    >;
  };
  rows: readonly BulkTarget[];
  // The distributions the confirmation listed for a repository: exactly these
  // are deleted with it, and only while they still serve it.
  shownFor: (repository: BulkTarget) => { name: string; pulp_href: string }[];
  signal?: AbortSignal;
  // How often a task that has not finished is read again.
  pollMs?: number;
}

// The text that says why a repository was kept: what was refused and why, what
// is still being removed and what was not shown to the user.
function keptReason(result: DeleteRepositoryResult): string {
  const parts: string[] = [];
  for (const { name, reason } of result.failed) {
    parts.push(t`Distribution ${name} was not removed: ${reason}`);
  }
  for (const { name } of result.pending) {
    parts.push(t`Distribution ${name} is still being removed.`);
  }
  for (const { name } of result.unknown) {
    parts.push(t`It is not known whether distribution ${name} was removed.`);
  }
  for (const name of result.unlisted) {
    parts.push(t`Distribution ${name} was not shown, so it was not removed.`);
  }
  if (result.repositoryError) {
    const reason = result.repositoryError;
    parts.push(t`The repository could not be removed: ${reason}`);
  }
  const removed = result.removed.length;
  const kept = t`The repository was kept.`;
  const done =
    removed > 0
      ? t`Distributions removed: ${result.removed.join(', ')}.`
      : undefined;

  return [kept, ...parts, ...(done ? [done] : [])].join(' ');
}

// What a delete of one repository came to, as the result row.
export function outcomeOfDelete(result: DeleteRepositoryResult): BulkOutcome {
  if (result.repositoryDeleted) {
    return {
      kind: 'succeeded',
      note: result.removed.length
        ? t`Distributions removed: ${result.removed.join(', ')}`
        : undefined,
    };
  }
  if (
    result.unconfirmed.length ||
    result.notSent.length ||
    result.repositoryUnconfirmed
  ) {
    return { kind: 'unconfirmed' };
  }
  if (result.repositoryPending) {
    return {
      kind: 'started',
      task: result.repositoryPending,
      note: t`Still being removed`,
    };
  }
  if (result.repositoryUnknown) {
    return {
      kind: 'started',
      task: result.repositoryUnknown,
      note: t`Outcome unknown, check the task`,
    };
  }

  return { kind: 'failed', reason: keptReason(result) };
}

// Deletes the repositories, each with the distributions the user was shown for
// it, with the delete of a single repository. What serves the repositories is
// read once, after the confirmation, and every repository is compared with it
// and with what was shown, so a distribution that appeared since the dialog
// opened is reported and keeps its repository. When that read fails nothing is
// sent and every row says so.
export async function bulkDelete(
  params: BulkDeleteParams,
  onSettled?: OnSettled,
): Promise<BulkResult[]> {
  const { rows, shownFor, signal, pollMs, ...entities } = params;

  let servingOf: Awaited<ReturnType<typeof readServingSnapshot>>;
  try {
    servingOf = await readServingSnapshot({
      distribution: entities.distribution,
      publication: entities.publication,
      signal,
    });
  } catch (error) {
    const reason = failureReason(
      error instanceof DeleteNotStarted ? error.cause : error,
    );
    const stopped = isSessionEnd(
      error instanceof DeleteNotStarted ? error.cause : error,
    );
    return rows.map((target) => {
      const result: BulkResult = {
        target,
        outcome: stopped
          ? { kind: 'not-sent' }
          : {
              kind: 'failed',
              reason: t`The distributions could not be listed, so nothing was deleted: ${reason}`,
            },
      };
      onSettled?.(result);
      return result;
    });
  }

  return runBulk(
    rows,
    async (target) =>
      outcomeOfDelete(
        await deleteRepositoryWithDistributions({
          ...entities,
          target,
          shown: shownFor(target),
          serving: servingOf(target.pulp_href),
          signal,
          pollMs,
        }),
      ),
    onSettled,
  );
}

// The counts of a run, for the summary alert and the dialog's own summary.
export interface BulkSummary {
  succeeded: number;
  started: number;
  skipped: number;
  failed: number;
  // rows that were not carried out because the session ended
  stopped: number;
}

export function summarize(results: readonly BulkResult[]): BulkSummary {
  const counts: BulkSummary = {
    succeeded: 0,
    started: 0,
    skipped: 0,
    failed: 0,
    stopped: 0,
  };
  for (const { outcome } of results) {
    switch (outcome.kind) {
      case 'succeeded':
        counts.succeeded += 1;
        break;
      case 'started':
        counts.started += 1;
        break;
      case 'skipped':
        counts.skipped += 1;
        break;
      case 'failed':
        counts.failed += 1;
        break;
      default:
        counts.stopped += 1;
    }
  }
  return counts;
}
