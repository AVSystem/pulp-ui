import { t } from '@lingui/core/macro';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type {
  PublicationBase,
  PublicationEntity,
} from 'src/entities/plugin/publication';
import type { Options } from 'src/entities/plugin/request';
import {
  isSessionEnd,
  requestErrorReason,
  requestErrorStatus,
} from 'src/utilities/request-error';
import {
  DeleteNotStarted,
  type DeleteRepositoryParams,
  type DeleteRepositoryResult,
  deleteRepositoryWithDistributions,
  readServingSnapshot,
} from '../delete/delete-repository';
import type { SyncBody, SyncDef } from '../descriptor';
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

// How many rows of one run are told to the application root to be followed to
// the end of their tasks. The root reads each followed task every few seconds
// and announces its end, which is right for a handful and would flood the
// server and the screen for five hundred; the result table links every task.
export const BULK_WATCH_LIMIT = 20;

// Turns the number of tasks a run has started into the question whether the
// next one is followed.
export function watchLimiter(limit = BULK_WATCH_LIMIT): () => boolean {
  let seen = 0;
  return () => {
    seen += 1;
    return seen <= limit;
  };
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

// Deletes remotes, each with one request that the server answers with the task
// that does the work. `onStarted` hands the task to whoever follows it.
export function bulkDeleteRemotes(
  entity: { remove: (href: string, options?: Options) => Promise<string> },
  rows: readonly BulkTarget[],
  onStarted: (row: BulkTarget, task: string) => void,
  onSettled?: OnSettled,
): Promise<BulkResult[]> {
  return runBulk(
    rows,
    async (row) => {
      const task = await entity.remove(row.pulp_href);
      onStarted(row, task);
      return { kind: 'started', task };
    },
    onSettled,
  );
}

// The options of a sync, as the dialog of a single repository sends them, for
// one row: an option the server would refuse for this repository goes with the
// value that is allowed.
export function syncBodyOf(
  sync: SyncDef<RepositoryBase>,
  values: Record<string, unknown>,
  row: RepositoryBase,
): SyncBody {
  return {
    ...(row.remote ? { remote: row.remote } : {}),
    ...Object.fromEntries(
      (sync.options ?? []).map((option) => [
        option.name,
        option.fixed?.(row)?.value ?? values[option.name],
      ]),
    ),
  };
}

// Starts a sync of every row that has a remote, with the options the user
// chose once. A row with no remote has nothing to sync from and is skipped
// without a request.
export function bulkSync(
  entity: {
    sync?: (href: string, body: SyncBody, options?: Options) => Promise<string>;
  },
  sync: SyncDef<RepositoryBase>,
  rows: readonly RepositoryBase[],
  values: Record<string, unknown>,
  onStarted: (row: RepositoryBase, task: string) => void,
  onSettled?: OnSettled<RepositoryBase>,
): Promise<BulkResult<RepositoryBase>[]> {
  return runBulk(
    rows,
    async (row) => {
      if (!row.remote) {
        return { kind: 'skipped', reason: t`No remote to sync from.` };
      }
      if (!entity.sync) {
        throw new Error('The plugin has no way to sync a repository');
      }
      const task = await entity.sync(
        row.pulp_href,
        syncBodyOf(sync, values, row),
      );
      onStarted(row, task);
      return { kind: 'started', task };
    },
    onSettled,
  );
}

// What the entities of a plugin offer to change one label.
interface LabelEntity {
  setLabel: (
    href: string,
    label: { key: string; value: string | null },
    options?: Options,
  ) => Promise<unknown>;
  unsetLabel: (
    href: string,
    key: string,
    options?: Options,
  ) => Promise<unknown>;
}

// Sets one label on every row, with one request each.
export function bulkSetLabel<Row extends BulkTarget>(
  entity: Pick<LabelEntity, 'setLabel'>,
  rows: readonly Row[],
  label: { key: string; value: string | null },
  onSettled?: OnSettled<Row>,
): Promise<BulkResult<Row>[]> {
  return runBulk(
    rows,
    async (row) => {
      await entity.setLabel(row.pulp_href, label);
      return { kind: 'succeeded' };
    },
    onSettled,
  );
}

// Whether the server refused the removal of a label because the object does
// not have it: it answers 400 and says the label is not set.
function isNotSet(error: unknown): boolean {
  return (
    requestErrorStatus(error) === 400 &&
    /is not set/i.test(requestErrorReason(error) ?? '')
  );
}

// Removes one label from every row that has it. A row that was read without the
// key is skipped without a request, and a row the server says does not have it
// (its labels changed since the list was read) is skipped too, not failed.
export function bulkUnsetLabel<
  Row extends BulkTarget & { pulp_labels?: Record<string, unknown> | null },
>(
  entity: Pick<LabelEntity, 'unsetLabel'>,
  rows: readonly Row[],
  key: string,
  onSettled?: OnSettled<Row>,
): Promise<BulkResult<Row>[]> {
  const skipped: BulkOutcome = {
    kind: 'skipped',
    reason: t`The label is not set.`,
  };

  return runBulk(
    rows,
    async (row) => {
      if (!Object.keys(row.pulp_labels ?? {}).includes(key)) {
        return skipped;
      }
      try {
        await entity.unsetLabel(row.pulp_href, key);
      } catch (error) {
        if (isNotSet(error)) {
          return skipped;
        }
        throw error;
      }
      return { kind: 'succeeded' };
    },
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
