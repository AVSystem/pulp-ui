import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResponseShapeError, parseResponse } from 'src/entities/response-shape';
import { taskPage, taskRow } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { TaskClient } from './client';
import { isFinalState, taskPageSchema, taskSchema } from './model';
import { taskKeys } from './queries';

describe('task model', { tags: ['unit'] }, () => {
  it('parses a list page with relative hrefs and keeps fields it does not name', () => {
    const row = taskRow({ name: 'pulp_file.app.tasks.synchronize' });
    const body = { ...taskPage([row]), extra: 'kept' };

    const parsed = parseResponse(taskPageSchema, body);

    expect(parsed.count).toBe(1);
    expect(parsed.results[0].pulp_href).toBe(row.pulp_href);
    expect(parsed.results[0].name).toBe('pulp_file.app.tasks.synchronize');
    expect(parsed.results[0].state).toBe('completed');
  });

  it('keeps a field a later server version adds', () => {
    const row = { ...taskRow(), brand_new_field: { a: 1 } };

    expect(parseResponse(taskSchema, row)).toMatchObject({
      brand_new_field: { a: 1 },
    });
  });

  it('refuses a row without pulp_href as a response shape error', () => {
    const row: Record<string, unknown> = taskRow();
    delete row['pulp_href'];

    expect(() =>
      parseResponse(taskPageSchema, taskPage([row as never])),
    ).toThrow(ResponseShapeError);
  });

  it('refuses a row whose pulp_href points to another host', () => {
    const row = taskRow({
      pulp_href: 'https://other.example/pulp/api/v3/tasks/1/',
    });

    expect(() => parseResponse(taskSchema, row)).toThrow(ResponseShapeError);
  });

  it('tells final states from the others', () => {
    for (const state of ['completed', 'failed', 'canceled', 'skipped']) {
      expect(isFinalState(state)).toBe(true);
    }
    for (const state of ['running', 'waiting', 'canceling']) {
      expect(isFinalState(state)).toBe(false);
    }
  });
});

describe('Integration: TaskClient', { tags: ['integration'] }, () => {
  it('lists the page the address asks for, as offset, limit and ordering', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/pulp/api/v3/tasks/', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(taskPage([taskRow()]));
      }),
    );

    await TaskClient.list({
      page: 3,
      page_size: 20,
      sort: '-started_at',
      name__contains: 'sync',
      state: 'running',
    });

    expect(seen).toHaveLength(1);
    expect(Object.fromEntries(seen[0])).toEqual({
      offset: '40',
      limit: '20',
      ordering: '-started_at',
      name__contains: 'sync',
      state: 'running',
    });
  });

  it('sends only the parameters that are set', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/pulp/api/v3/tasks/', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(taskPage([]));
      }),
    );

    await TaskClient.list({});

    expect(Object.fromEntries(seen[0])).toEqual({ offset: '0', limit: '10' });
  });

  it('rejects an answer whose rows have no pulp_href', async () => {
    server.use(
      http.get('*/pulp/api/v3/tasks/', () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ name: 'x', state: 'completed' }],
        }),
      ),
    );

    await expect(TaskClient.list({})).rejects.toThrow(ResponseShapeError);
  });

  it('retrieves a task by its href', async () => {
    const row = taskRow({ name: 'zz.one' });
    server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

    await expect(TaskClient.retrieve(row.pulp_href)).resolves.toMatchObject({
      pulp_href: row.pulp_href,
      name: 'zz.one',
    });
  });

  it('cancels a task with one PATCH to its href', async () => {
    const row = taskRow({ state: 'running' });
    const bodies: unknown[] = [];
    server.use(
      http.patch(`*${row.pulp_href}`, async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({ ...row, state: 'canceling' });
      }),
    );

    const answer = await TaskClient.cancel(row.pulp_href);

    expect(bodies).toEqual([{ state: 'canceled' }]);
    expect(answer.state).toBe('canceling');
  });

  it('passes the abort signal to the request', async () => {
    server.use(
      http.get('*/pulp/api/v3/tasks/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json(taskPage([]));
      }),
    );
    const controller = new AbortController();

    const pending = TaskClient.list({}, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow();
  });
});

describe('Integration: TaskClient counts and time windows', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a set of states as one comma separated filter', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/pulp/api/v3/tasks/', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(taskPage([]));
      }),
    );

    await TaskClient.list({ state__in: 'failed,completed,canceled' });

    expect(seen[0].get('state__in')).toBe('failed,completed,canceled');
  });

  it('turns a time window into a lower bound on the finish time when it asks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-01T12:00:00.000Z'));
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/pulp/api/v3/tasks/', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json(taskPage([]));
      }),
    );

    await TaskClient.list({ finishedWithinMs: 24 * 60 * 60 * 1000 });
    vi.setSystemTime(new Date('2030-05-01T13:00:00.000Z'));
    await TaskClient.list({ finishedWithinMs: 24 * 60 * 60 * 1000 });

    expect(seen.map((query) => query.get('finished_at__gte'))).toEqual([
      '2030-04-30T12:00:00.000Z',
      '2030-04-30T13:00:00.000Z',
    ]);
  });

  it('counts the tasks of one state by asking for a single row', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.get('*/pulp/api/v3/tasks/', ({ request }) => {
        seen.push(new URL(request.url).searchParams);
        return HttpResponse.json({
          count: 42,
          next: null,
          previous: null,
          results: [taskRow({ state: 'running' })],
        });
      }),
    );

    await expect(TaskClient.count({ state: 'running' })).resolves.toBe(42);

    expect(Object.fromEntries(seen[0])).toEqual({
      state: 'running',
      limit: '1',
      offset: '0',
    });
  });

  it('refuses a count answer without a number as a response shape error', async () => {
    server.use(
      http.get('*/pulp/api/v3/tasks/', () =>
        HttpResponse.json({ results: [] }),
      ),
    );

    await expect(TaskClient.count({ state: 'running' })).rejects.toThrow(
      ResponseShapeError,
    );
  });
});

describe('task query keys', { tags: ['unit'] }, () => {
  it('keeps every key under the task prefix, so one invalidation reaches them all', () => {
    const filter = { state: 'running' };

    expect(taskKeys.count(filter).slice(0, 3)).toEqual(taskKeys.all);
    expect(taskKeys.count(filter).slice(0, 4)).toEqual(taskKeys.counts);
    expect(taskKeys.count(filter)[4]).toEqual(filter);
  });
});
