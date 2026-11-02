import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { task } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { TaskPending, waitForTask, waitForTaskUrl } from './wait-for-task';

const TASK_ID = '00000000-0000-4000-8000-0000000000bb';
const TASK_HREF = `/pulp/api/v3/tasks/${TASK_ID}/`;

let polls: number;

beforeEach(() => {
  polls = 0;
});

afterEach(() => {
  server.resetHandlers();
});

// Answers every poll with the given task and counts the polls.
function serveTask(overrides: Parameters<typeof task>[0]) {
  server.use(
    http.get('*/pulp/api/v3/tasks/:id/', () => {
      polls += 1;
      return HttpResponse.json(task({ pulp_href: TASK_HREF, ...overrides }));
    }),
  );
}

const fast = { waitMs: 1, multiplier: 1 };

describe('waitForTask', () => {
  it('resolves once the task has completed', async () => {
    serveTask({ state: 'completed' });

    await expect(waitForTask(TASK_ID, fast)).resolves.toBeUndefined();
    expect(polls).toBe(1);
  });

  it('keeps polling while the task runs and resolves when it completes', async () => {
    let state = 'running';
    server.use(
      http.get('*/pulp/api/v3/tasks/:id/', () => {
        polls += 1;
        if (polls === 3) {
          state = 'completed';
        }
        return HttpResponse.json(task({ pulp_href: TASK_HREF, state }));
      }),
    );

    await expect(waitForTask(TASK_ID, fast)).resolves.toBeUndefined();
    expect(polls).toBe(3);
  });

  it('rejects with the error description of a failed task', async () => {
    serveTask({ state: 'failed', error: { description: 'disk is full' } });

    const outcome = await waitForTask(TASK_ID, fast).catch((e: unknown) => e);

    expect(outcome).toBe('disk is full');
    expect(outcome).not.toBeInstanceOf(TaskPending);
  });

  it('rejects with a readable message for a canceled task without an error', async () => {
    serveTask({ state: 'canceled' });

    const outcome = await waitForTask(TASK_ID, fast).catch((e: unknown) => e);

    expect(outcome).toBe('Task failed without error message.');
    expect(outcome).not.toBeInstanceOf(TaskPending);
  });

  it('rejects with TaskPending carrying the task href when the task outlives the attempts', async () => {
    serveTask({ state: 'running' });

    const outcome = await waitForTask(TASK_ID, { ...fast, bailAfter: 2 }).catch(
      (e: unknown) => e,
    );

    expect(outcome).toBeInstanceOf(TaskPending);
    expect((outcome as TaskPending).taskHref).toBe(TASK_HREF);
  });

  it('names the number of attempts actually made, not a fixed number', async () => {
    serveTask({ state: 'waiting' });

    const outcome = await waitForTask(TASK_ID, { ...fast, bailAfter: 2 }).catch(
      (e: unknown) => e,
    );

    expect(polls).toBe(3);
    expect((outcome as Error).message).toBe(
      'Giving up waiting for task after 3 attempts.',
    );
  });

  it('makes one attempt more than the retries it was allowed', async () => {
    serveTask({ state: 'running' });

    await waitForTask(TASK_ID, { ...fast, bailAfter: 0 }).catch(() => null);

    expect(polls).toBe(1);
  });
});

describe('waitForTaskUrl', () => {
  it('reads the task id from the task href', async () => {
    serveTask({ state: 'completed' });

    await expect(waitForTaskUrl(TASK_HREF, fast)).resolves.toBeUndefined();
    expect(polls).toBe(1);
  });
});
