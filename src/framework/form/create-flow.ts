import { t } from '@lingui/core/macro';
import type { AlertType } from 'src/components';
import { DistributionClient } from 'src/entities/core/distribution/client';
import { TaskClient } from 'src/entities/core/task/client';
import { isFinalState } from 'src/entities/core/task/model';
import type { DistributionCreate } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { RepositoryCreate } from 'src/entities/plugin/repository';
import type { Options } from 'src/entities/plugin/request';
import { forbiddenTexts } from 'src/utilities/fail-alerts';
import { mapErrorMessages } from 'src/utilities/map-error-messages';
import {
  isSessionEnd,
  requestErrorStatus,
  requestErrorText,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';

// Creates a repository and, only when asked, a distribution named after it, on
// the entities of the plugin. The name and the base path are checked against
// every plugin's distributions first, so a conflict stops everything before a
// single write. The repository is not rolled back when the distribution fails:
// it is valid on its own, and the outcome tells the user what was not done.
// Nothing is ever retried, with the same or with another name or base path.

// What the user asked for beside the repository.
export interface DistributionRequest {
  basePath: string;
}

// The fields a refused check can name, and the message that belongs to no
// field.
export interface BlockedFields {
  name?: string;
  base_path?: string;
}

// What became of the distribution that was asked for.
export type DistributionOutcome =
  // none was asked for
  | { state: 'none' }
  // the task that creates it finished
  | { state: 'created' }
  // the request or its task failed, with the server's reason
  | { state: 'failed'; reason: string }
  // the task had not finished when the screen was left; it may still create
  // the distribution, so it is neither failed nor created again
  | { state: 'pending'; task: string }
  // the task's status could not be read, so it is not known whether the
  // distribution exists
  | { state: 'unknown'; task: string }
  // the session ended before the distribution was confirmed: the sign-in
  // dialog explains the failure, so the outcome carries none
  | { state: 'unconfirmed' };

export type CreateOutcome =
  // Nothing was written: the name or the base path is taken, or the check could
  // not run. `fields` is what belongs under a field, `general` what belongs to
  // none.
  | { kind: 'blocked'; fields: BlockedFields; general: string | null }
  | {
      kind: 'created';
      repositoryHref: string;
      distribution: DistributionOutcome;
    };

interface Params {
  repository: {
    create: (
      body: RepositoryCreate,
      options?: Options,
    ) => Promise<RepositoryBase>;
  };
  distributions: {
    create: (body: DistributionCreate, options?: Options) => Promise<string>;
  };
  // The body of the repository's create; its name is the distribution's name.
  body: RepositoryCreate;
  // Null or absent when no distribution is asked for.
  distribution?: DistributionRequest | null;
  // Ends the wait for the distribution's task, for a screen that is left
  // before the task has finished.
  signal?: AbortSignal;
  // How often the distribution's task is read while it has not finished.
  pollMs?: number;
}

// How often a task that has not finished is read again.
const POLL_MS = 2000;

// One readable sentence for a failed request or task: the refusal in its
// three parts, the server's field and general messages joined, or the status
// line.
export function failureReason(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }

  const status = requestErrorStatus(error);
  if (status === 403) {
    const { sentence, detail, hint } = forbiddenTexts(error);
    return `${sentence} ${detail} ${hint}`;
  }
  if (status !== null) {
    const messages = Object.entries(mapErrorMessages(error))
      .filter(([, message]) => message)
      .map(([field, message]) => {
        const text = Array.isArray(message) ? message.join(' ') : message;
        return ['__nofield', 'non_field_errors', 'detail'].includes(field)
          ? text
          : `${field}: ${text}`;
      });

    return messages.length > 0 ? messages.join(' ') : requestErrorText(error);
  }

  return requestErrorText(error);
}

const pause = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done);
  });

// Reads the task until it has finished. It stops only on a final state, a
// refusal, a task that is not there, a first read that failed, the end of the
// session or the signal: there is no limit on how long a task may take. A
// later read that fails for another reason is tried again.
async function outcomeOfTask(
  task: string,
  signal: AbortSignal | undefined,
  pollMs: number,
): Promise<DistributionOutcome> {
  let read = false;

  for (;;) {
    if (signal?.aborted) {
      return { state: 'pending', task };
    }
    try {
      const found = await TaskClient.retrieve(task, { signal });
      read = true;
      if (isFinalState(found.state)) {
        const description = found.error?.['description'];
        return found.state === 'completed'
          ? { state: 'created' }
          : {
              state: 'failed',
              reason:
                typeof description === 'string' && description
                  ? description
                  : t`Task failed without error message.`,
            };
      }
    } catch (error) {
      if (isSessionEnd(error)) {
        return { state: 'unconfirmed' };
      }
      if (signal?.aborted) {
        return { state: 'pending', task };
      }
      const status = requestErrorStatus(error);
      if (!read || status === 403 || status === 404) {
        return { state: 'unknown', task };
      }
    }
    await pause(pollMs, signal);
  }
}

// Whether the name and the base path are free. A check that could not run is
// not a check that passed. The end of the session is rethrown: nothing was
// written, and the sign-in dialog explains it.
async function conflictsOf(
  name: string,
  basePath: string,
): Promise<Extract<CreateOutcome, { kind: 'blocked' }> | null> {
  let byName;
  let byPath;
  try {
    [byName, byPath] = await Promise.all([
      DistributionClient.existsByName(name),
      DistributionClient.existsByBasePath(basePath),
    ]);
  } catch (error) {
    if (isSessionEnd(error)) {
      throw error;
    }
    const reason = failureReason(error);
    return {
      kind: 'blocked',
      fields: {},
      general: t`Could not check whether the name and base path are free: ${reason}. Nothing was created.`,
    };
  }

  const fields: BlockedFields = {};
  if (byName) {
    fields.name = t`A distribution named "${name}" already exists.`;
  }
  if (byPath) {
    const otherName = byPath.name;
    const otherPath = byPath.base_path;
    fields.base_path = t`The base path "${basePath}" is already used by or overlaps the distribution "${otherName}" (${otherPath}).`;
  }

  return Object.keys(fields).length > 0
    ? { kind: 'blocked', fields, general: null }
    : null;
}

export async function createRepositoryWithDistribution({
  repository,
  distributions,
  body,
  distribution = null,
  signal,
  pollMs = POLL_MS,
}: Params): Promise<CreateOutcome> {
  if (distribution) {
    const blocked = await conflictsOf(body.name, distribution.basePath);
    if (blocked) {
      return blocked;
    }
  }

  // A failure here leaves nothing behind and is thrown for the form.
  const created = await repository.create(body);
  const repositoryHref = created.pulp_href;

  if (!distribution) {
    return {
      kind: 'created',
      repositoryHref,
      distribution: { state: 'none' },
    };
  }

  try {
    const task = await distributions.create({
      name: body.name,
      base_path: distribution.basePath,
      repository: repositoryHref,
    });
    return {
      kind: 'created',
      repositoryHref,
      distribution: await outcomeOfTask(task, signal, pollMs),
    };
  } catch (error) {
    return {
      kind: 'created',
      repositoryHref,
      // Whether the distribution was created is not claimed either way when the
      // session ended.
      distribution: isSessionEnd(error)
        ? { state: 'unconfirmed' }
        : { state: 'failed', reason: failureReason(error) },
    };
  }
}

// The alerts shown after a create: the repository, and for a requested
// distribution whether it exists, failed, or is still being created.
export function createAlerts(
  name: string,
  distribution: DistributionRequest | null,
  outcome: DistributionOutcome,
): AlertType[] {
  switch (outcome.state) {
    case 'unconfirmed':
      return [
        {
          variant: 'warning',
          title: t`Repository "${name}" was created. Its distribution was not confirmed.`,
          description: t`The session ended before the distribution could be created. After you log in, check the distributions and create it if it is missing.`,
        },
      ];
    case 'failed': {
      const { reason } = outcome;
      return [
        {
          variant: 'danger',
          title: t`Repository "${name}" was created. The distribution "${name}" was not created: ${reason}`,
        },
      ];
    }
    case 'unknown':
      return [
        taskAlert(
          outcome.task,
          t`Repository "${name}" was created. The outcome of creating the distribution "${name}" is unknown, because the task status could not be read. Check the task.`,
          'warning',
        ),
      ];
    case 'pending':
      return [
        taskAlert(
          outcome.task,
          t`Repository "${name}" was created. The distribution "${name}" is still being created and is not served yet.`,
          'warning',
        ),
      ];
    default: {
      const alerts: AlertType[] = [
        {
          variant: 'success',
          title: t`Successfully created repository ${name}`,
        },
      ];
      if (distribution && outcome.state === 'created') {
        const { basePath } = distribution;
        alerts.push({
          variant: 'success',
          title: t`Created distribution "${name}" at base path ${basePath}.`,
        });
      }
      return alerts;
    }
  }
}
