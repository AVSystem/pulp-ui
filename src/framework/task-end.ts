import { t } from '@lingui/core/macro';
import { TaskClient } from 'src/entities/core/task/client';
import { isFinalState } from 'src/entities/core/task/model';
import { isSessionEnd, requestErrorStatus } from 'src/utilities/request-error';

// How a task a screen waits for has ended, as far as the screen could tell.
export type TaskEnd =
  // the task finished its work; `created` holds the addresses of the objects
  // it made
  | { state: 'completed'; created: string[] }
  // the task failed, was skipped or was canceled, with the server's reason
  | { state: 'failed'; reason: string }
  // the wait was ended from outside (a screen left on purpose) before the task
  // finished; it may still do its work
  | { state: 'pending' }
  // the task's status could not be read, so what became of it is not known
  | { state: 'unknown' }
  // the session ended while the task was read: the sign-in dialog explains it,
  // so there is nothing to say about the task
  | { state: 'unconfirmed' };

// How often a task that has not finished is read again.
export const TASK_POLL_MS = 2000;

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
export async function readTaskToEnd(
  task: string,
  { signal, pollMs = TASK_POLL_MS }: { signal?: AbortSignal; pollMs?: number },
): Promise<TaskEnd> {
  let read = false;

  for (;;) {
    if (signal?.aborted) {
      return { state: 'pending' };
    }
    try {
      const found = await TaskClient.retrieve(task, { signal });
      read = true;
      if (isFinalState(found.state)) {
        const description = found.error?.['description'];
        return found.state === 'completed'
          ? { state: 'completed', created: found.created_resources ?? [] }
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
        return { state: 'pending' };
      }
      const status = requestErrorStatus(error);
      if (!read || status === 403 || status === 404) {
        return { state: 'unknown' };
      }
    }
    await pause(pollMs, signal);
  }
}
