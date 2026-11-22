import { t } from '@lingui/core/macro';
import type { AlertType } from 'src/components';
import { ContentGuardClient } from 'src/entities/core/content-guard/client';
import { DistributionClient } from 'src/entities/core/distribution/client';
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
import {
  type Chosen,
  contentGuardOf,
} from '../distributions/protection-choice';
import { TASK_POLL_MS, readTaskToEnd } from '../task-end';

// Creates a repository and, only when asked, a distribution named after it, on
// the entities of the plugin. The name and the base path are checked against
// every plugin's distributions first, so a conflict stops everything before a
// single write. The repository is not rolled back when the distribution fails:
// it is valid on its own, and the outcome tells the user what was not done.
// Nothing is ever retried, with the same or with another name or base path.

// What the user asked for beside the repository: the base path and how the
// distribution is protected. The protection is always a decided one; a request
// without it is never made, because leaving the choice out would make the
// distribution public.
export interface DistributionRequest {
  basePath: string;
  protection: Chosen;
}

// The content guard a created distribution really has when it is not the one
// that was asked for: its address, null when it has none, and the guard's name
// when the user may read it (null otherwise).
export interface GuardSet {
  href: string | null;
  name: string | null;
}

// What became of the distribution that was asked for.
export type DistributionOutcome =
  // none was asked for
  | { state: 'none' }
  // the task that creates it finished; `guardSet` is present only when the
  // server gave the distribution a guard other than the one asked for (a
  // domain's default guard, a plugin's own guard) or left out the one asked for
  | { state: 'created'; guardSet?: GuardSet }
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
  // not run. `fields` holds the message of each field the check names (`name`,
  // `base_path`), `general` the one that belongs to none.
  | { kind: 'blocked'; fields: Record<string, string>; general: string | null }
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
  // The plugin's distributions; absent for a plugin that has none, which can
  // not be asked for one.
  distributions?: {
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

// The guard the created distribution has when it differs from the one asked for,
// or undefined when it is the one asked for or when it cannot be told. The
// distribution is read once, at the address the task says it made; when the
// task names none, or the read fails, nothing is claimed beyond the creation.
// A guard that is not the one asked for is named when the user may read it.
// The end of the session is rethrown for the caller to report.
export async function guardActuallySet(
  created: readonly string[],
  asked: string | null,
  options?: RequestInit,
): Promise<GuardSet | undefined> {
  const href = created.find((address) => address.includes('/distributions/'));
  if (!href) {
    return undefined;
  }

  let actual: string | null | undefined;
  try {
    actual = await DistributionClient.guardOf(href, options);
  } catch (error) {
    if (isSessionEnd(error)) {
      throw error;
    }
    return undefined;
  }
  if (actual === undefined || actual === asked) {
    return undefined;
  }
  if (actual === null) {
    return { href: null, name: null };
  }

  let name: string | null = null;
  try {
    const names = await ContentGuardClient.names([actual], options);
    name = names.get(actual) ?? null;
  } catch (error) {
    if (isSessionEnd(error)) {
      throw error;
    }
  }

  return { href: actual, name };
}

// What became of the distribution's task, in the terms of the outcome.
async function outcomeOfTask(
  task: string,
  asked: string | null,
  signal: AbortSignal | undefined,
  pollMs: number,
): Promise<DistributionOutcome> {
  const end = await readTaskToEnd(task, { signal, pollMs });

  switch (end.state) {
    case 'completed': {
      const guardSet = await guardActuallySet(end.created, asked, { signal });
      return guardSet ? { state: 'created', guardSet } : { state: 'created' };
    }
    case 'failed':
      return { state: 'failed', reason: end.reason };
    case 'pending':
      return { state: 'pending', task };
    case 'unknown':
      return { state: 'unknown', task };
    default:
      return { state: 'unconfirmed' };
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

  const fields: Record<string, string> = {};
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
  pollMs = TASK_POLL_MS,
}: Params): Promise<CreateOutcome> {
  if (distribution && !distributions) {
    throw new Error('The plugin has no distributions to create');
  }
  // Checked before anything is written, so a missing choice leaves nothing
  // behind, the repository included.
  const contentGuard = distribution
    ? contentGuardOf(distribution.protection)
    : null;
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
    const task = await (
      distributions as NonNullable<typeof distributions>
    ).create({
      name: body.name,
      base_path: distribution.basePath,
      repository: repositoryHref,
      content_guard: contentGuard,
    });
    return {
      kind: 'created',
      repositoryHref,
      distribution: await outcomeOfTask(task, contentGuard, signal, pollMs),
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

// What the distribution that was created says about its protection: the guard
// the server really set when it is not the one that was asked for, otherwise
// the protection that was chosen. The same sentences serve every form that
// creates a distribution.
export function protectionDescription(
  protection: Chosen,
  guardSet?: GuardSet,
): { text: string; variant: 'success' | 'warning' } {
  if (guardSet?.href) {
    const guard = guardSet.name
      ? `"${guardSet.name}"`
      : t`a content guard you may not see`;
    return {
      text: t`The server protected the distribution with ${guard}.`,
      variant: 'warning',
    };
  }
  if (guardSet) {
    return {
      text: t`The server did not apply the content guard you chose: the distribution has no content guard.`,
      variant: 'warning',
    };
  }

  return {
    text:
      protection === 'public'
        ? t`It is public: anyone can download from it without signing in.`
        : t`It is protected by the content guard you chose.`,
    variant: 'success',
  };
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
        const { basePath, protection } = distribution;
        const { text, variant } = protectionDescription(
          protection,
          outcome.guardSet,
        );
        alerts.push({
          variant,
          title: t`Created distribution "${name}" at base path ${basePath}.`,
          description: text,
        });
      }
      return alerts;
    }
  }
}
