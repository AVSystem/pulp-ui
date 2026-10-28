import { t } from '@lingui/core/macro';
import { distributionConflicts } from './distribution-availability';
import { type ErrorMessagesType, mapErrorMessages } from './map-error-messages';
import { waitForTaskUrl } from './wait-for-task';

// Thrown before anything is written: the requested name or base path is taken
// or could not be checked. `errors` is keyed by form field, with `__nofield`
// for a message that belongs to no field.
export class CreateBlocked extends Error {
  errors: ErrorMessagesType;

  constructor(errors: ErrorMessagesType) {
    super(Object.values(errors).join(' '));
    Object.setPrototypeOf(this, CreateBlocked.prototype);
    this.name = 'CreateBlocked';
    this.errors = errors;
  }
}

export interface CreateRepositoryResult {
  repositoryHref: string;
  // why the requested distribution does not exist; null when it was not
  // requested or was created
  distributionError: string | null;
}

interface CreateRepositoryParams {
  RepositoryAPI: { create: (data) => Promise<{ data }> };
  DistributionAPI: { create: (data) => Promise<{ data }> };
  data: { name: string };
  distribution: { basePath: string } | null;
}

// Turns a failed request or task into one readable sentence: the server's
// field and non-field messages joined, a task's error description, or the
// error's own message.
export function failureReason(e): string {
  if (typeof e === 'string') {
    return e;
  }

  if (e?.response) {
    const { status, statusText } = e.response;
    let messages: string[] = [];
    try {
      messages = Object.entries(mapErrorMessages(e))
        .filter(([, message]) => message)
        .map(([field, message]) => {
          const text = Array.isArray(message) ? message.join(' ') : message;
          return ['__nofield', 'non_field_errors', 'detail'].includes(field)
            ? text
            : `${field}: ${text}`;
        });
    } catch {
      // a response without a readable body falls through to the status line
    }

    return messages.length ? messages.join(' ') : `${status} ${statusText}`;
  }

  return e?.message ?? String(e);
}

// Maps whatever a save attempt threw onto the form: a blocked create keeps its
// per-field messages, a server rejection is shown by field, anything without a
// response is shown without one.
export function saveErrorMessages(e): ErrorMessagesType {
  if (e instanceof CreateBlocked) {
    return e.errors;
  }

  if (e?.response) {
    try {
      const messages = mapErrorMessages(e);
      const general = messages['non_field_errors'] || messages['detail'];
      return general ? { __nofield: general, ...messages } : messages;
    } catch {
      return { __nofield: failureReason(e) };
    }
  }

  return { __nofield: failureReason(e) };
}

// Creates a repository and, only when asked, a distribution named after it.
// The name and base path are checked first, so a conflict stops everything
// before a single write. The repository is not rolled back when the
// distribution fails: it is valid on its own, and the caller tells the user
// what was not done. Nothing is ever retried with another name or base path.
export async function createRepository({
  RepositoryAPI,
  DistributionAPI,
  data,
  distribution,
}: CreateRepositoryParams): Promise<CreateRepositoryResult> {
  if (distribution) {
    const { basePath } = distribution;
    let conflicts;
    try {
      conflicts = await distributionConflicts(data.name, basePath);
    } catch (e) {
      const reason = failureReason(e);
      throw new CreateBlocked({
        __nofield: t`Could not check whether the name and base path are free: ${reason}. Nothing was created.`,
      });
    }

    const errors: ErrorMessagesType = {};
    if (conflicts.name) {
      errors['name'] = t`A distribution named "${data.name}" already exists.`;
    }
    if (conflicts.basePath) {
      const otherName = conflicts.basePath.name;
      const otherPath = conflicts.basePath.base_path;
      errors['base_path'] =
        t`The base path "${basePath}" is already used by or overlaps the distribution "${otherName}" (${otherPath}).`;
    }
    if (Object.keys(errors).length) {
      throw new CreateBlocked(errors);
    }
  }

  // a failure here leaves nothing behind and is rethrown for the form
  const { data: repository } = await RepositoryAPI.create(data);
  const repositoryHref: string = repository.pulp_href;

  if (!distribution) {
    return { repositoryHref, distributionError: null };
  }

  try {
    const { data: created } = await DistributionAPI.create({
      name: data.name,
      base_path: distribution.basePath,
      repository: repositoryHref,
    });
    await waitForTaskUrl(created.task);
  } catch (e) {
    return { repositoryHref, distributionError: failureReason(e) };
  }

  return { repositoryHref, distributionError: null };
}
