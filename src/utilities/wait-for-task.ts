import { t } from '@lingui/core/macro';
import { config } from 'src/ui-config';
import { TaskAPI } from '../api/task';
import { parsePulpIDFromURL } from './parse-pulp-id';

interface Options {
  bailAfter?: number;
  multiplier?: number;
  waitMs?: number;
}

// The task was still waiting or running when the polling gave up. It is not a
// failure: the task may finish later, so callers must not report the work as
// failed or undone.
export class TaskPending extends Error {
  taskHref: string;

  constructor(taskHref: string, attempts: number) {
    super(t`Giving up waiting for task after ${attempts} attempts.`);
    Object.setPrototypeOf(this, TaskPending.prototype);
    this.name = 'TaskPending';
    this.taskHref = taskHref;
  }
}

// The task's status could not be read (a proxy error, a dropped connection, a
// refused status request). The request that started the task was accepted, so
// the work may well have been done: callers must neither report it as failed
// nor as still running, only that the outcome is unknown and where to look. It
// is a TaskPending, so a caller that does not tell the two apart still avoids
// claiming a failure.
export class TaskUnknown extends TaskPending {
  constructor(taskHref: string) {
    super(taskHref, 0);
    Object.setPrototypeOf(this, TaskUnknown.prototype);
    this.name = 'TaskUnknown';
    this.message = t`The status of the task could not be read.`;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Polls a task until it has completed. Rejects with the task's error
// description when it failed, was skipped or was canceled, with a TaskPending
// when it is still unfinished after the last attempt, and with a TaskUnknown
// when a status request failed.
export async function waitForTask(task, options: Options = {}) {
  // default to starting with a 2s wait, increasing the wait time 1.5x each time, with max 10 retries
  // 2000, 1.5, 10 = ~226s ; 500, 1.5, 10 = ~57s
  const { waitMs = 2000, multiplier = 1.5, bailAfter = 10 } = options;
  const failing = ['skipped', 'failed', 'canceled'];

  let wait = waitMs;
  for (let attempt = 1; ; attempt++) {
    let data;
    try {
      ({ data } = await TaskAPI.get(task));
    } catch {
      throw new TaskUnknown(`${config.API_BASE_PATH}tasks/${task}/`);
    }

    if (failing.includes(data.state)) {
      return Promise.reject(
        data.error?.description ?? t`Task failed without error message.`,
      );
    }

    if (data.state === 'completed') {
      return;
    }

    if (attempt > bailAfter) {
      throw new TaskPending(data.pulp_href, attempt);
    }

    await sleep(wait);
    wait = Math.round(wait * multiplier);
  }
}

export function waitForTaskUrl(taskUrl, options = {}) {
  return waitForTask(parsePulpIDFromURL(taskUrl), options);
}
