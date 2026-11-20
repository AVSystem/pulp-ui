import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { type ITaskRow, taskListHandler, taskRow } from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import {
  INDEX_POLL_MS,
  buildTaskIndex,
  lastTaskOf,
  useTaskIndex,
} from './task-index';

const TASKS = '/pulp/api/v3/tasks/';

const REPOSITORY = 'prn:file.filerepository:11111111';
const OTHER = 'prn:file.filerepository:22222222';
const DOMAIN = 'shared:prn:core.domain:99999999';

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

// A task that reserves the given objects, newest when its day is the largest.
function taskOf(
  day: number,
  state: string,
  reserved: string[],
  overrides: Partial<ITaskRow> = {},
): ITaskRow {
  return taskRow({
    state,
    pulp_created: `2030-01-${String(day).padStart(2, '0')}T10:00:00.000000Z`,
    reserved_resources_record: [...reserved, DOMAIN],
    ...overrides,
  });
}

describe('Unit: lastTaskOf', { tags: ['unit'] }, () => {
  it('finds the newest task that reserves the repository, exclusively or shared', () => {
    const older = taskOf(1, 'completed', [REPOSITORY]);
    const newer = taskOf(3, 'completed', [`shared:${REPOSITORY}`]);
    const unrelated = taskOf(5, 'completed', [OTHER]);

    const index = buildTaskIndex([], [unrelated, older, newer]);

    expect(lastTaskOf(index, REPOSITORY)).toBe(newer);
    expect(lastTaskOf(index, OTHER)).toBe(unrelated);
  });

  it('says there is no recent task for a repository no task reserves', () => {
    const index = buildTaskIndex([], [taskOf(1, 'completed', [OTHER])]);

    expect(lastTaskOf(index, REPOSITORY)).toBeNull();
    expect(lastTaskOf(index, null)).toBeNull();
    expect(lastTaskOf(index, undefined)).toBeNull();
  });

  it('matches the whole PRN, never a part of it or another kind of entry', () => {
    const longer = taskOf(2, 'completed', [`${REPOSITORY}0`]);
    const old = taskOf(3, 'completed', [`pdrn:1:${REPOSITORY}`]);

    const index = buildTaskIndex([], [longer, old]);

    expect(lastTaskOf(index, REPOSITORY)).toBeNull();
    // every task reserves the domain, which is no repository
    expect(lastTaskOf(index, 'prn:core.domain:99999999')).not.toBeNull();
  });

  it('takes a running task as the last one only when it is the newest', () => {
    const finishedLater = taskOf(4, 'completed', [REPOSITORY]);
    const running = taskOf(2, 'running', [REPOSITORY]);
    const runningNow = taskOf(6, 'running', [REPOSITORY]);

    expect(
      lastTaskOf(buildTaskIndex([running], [finishedLater]), REPOSITORY),
    ).toBe(finishedLater);
    expect(
      lastTaskOf(buildTaskIndex([runningNow], [finishedLater]), REPOSITORY),
    ).toBe(runningNow);
  });

  it('prefers the active task when two tasks were created at the same time', () => {
    const waiting = taskOf(2, 'waiting', [REPOSITORY]);
    const done = taskOf(2, 'completed', [REPOSITORY]);

    expect(lastTaskOf(buildTaskIndex([waiting], [done]), REPOSITORY)).toBe(
      waiting,
    );
    expect(lastTaskOf(buildTaskIndex([], [done, waiting]), REPOSITORY)).toBe(
      waiting,
    );
  });

  it('holds a task that is in both reads once, as the active read has it', () => {
    const inBoth = taskOf(2, 'running', [REPOSITORY]);
    const staleCopy = { ...inBoth, state: 'waiting' };

    const index = buildTaskIndex([inBoth], [staleCopy]);

    expect(index.tasks).toHaveLength(1);
    expect(lastTaskOf(index, REPOSITORY)?.state).toBe('running');
  });
});

describe(
  'Integration: the tasks filter semantics of the server',
  { tags: ['integration'] },
  () => {
    const first = 'prn:file.filerepository:aaaa';
    const second = 'prn:file.filerepository:bbbb';
    const both = taskOf(1, 'completed', [first, second]);
    const onlyFirst = taskOf(2, 'completed', [first]);
    const onlySecond = taskOf(3, 'completed', [`shared:${second}`]);

    async function read(query: string): Promise<string[]> {
      const { handler } = taskListHandler([both, onlyFirst, onlySecond]);
      server.use(handler);
      const response = await fetch(`https://pulp.example${TASKS}?${query}`);
      const body = (await response.json()) as { results: ITaskRow[] };
      return body.results.map((row) => row.pulp_href);
    }

    it('matches a task by one reserved resource, held exclusively or shared', async () => {
      expect(await read(`reserved_resources=${second}`)).toEqual([
        both.pulp_href,
        onlySecond.pulp_href,
      ]);
    });

    it('combines the values of reserved_resources__in with AND, so a page of repositories matches only a task that reserves all of them', async () => {
      expect(await read(`reserved_resources__in=${first},${second}`)).toEqual([
        both.pulp_href,
      ]);
      expect(
        await read(`reserved_resources__in=${first},${second},prn:other`),
      ).toEqual([]);
    });
  },
);

// The paths of the recorded tasks requests as the index sends them.
function queryOf(query: URLSearchParams) {
  return {
    states: query.get('state__in'),
    ordering: query.get('ordering'),
    limit: query.get('limit'),
    fields: query.getAll('fields'),
    offset: query.get('offset'),
  };
}

const ACTIVE = (query: URLSearchParams) => query.has('state__in');
const RECENT = (query: URLSearchParams) => !query.has('state__in');

describe('Integration: useTaskIndex', { tags: ['integration'] }, () => {
  let intervals: IIntervals;

  beforeEach(() => {
    intervals = trackIntervals();
  });

  afterEach(() => {
    intervals.restore();
    Reflect.deleteProperty(document, 'visibilityState');
  });

  const done = taskOf(1, 'completed', [REPOSITORY]);
  const running = taskOf(2, 'running', [OTHER]);

  it('reads the waiting and running tasks and the newest 1000 with restricted fields', async () => {
    const { handler, queries } = taskListHandler([done, running]);
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(queries).toHaveLength(2);

    const active = queries.find(ACTIVE) as URLSearchParams;
    const recent = queries.find(RECENT) as URLSearchParams;
    expect(queryOf(active)).toMatchObject({
      states: 'waiting,running',
      limit: '1000',
      offset: '0',
    });
    expect(queryOf(recent)).toMatchObject({
      ordering: '-pulp_created',
      limit: '1000',
      offset: '0',
    });
    for (const query of [active, recent]) {
      expect(queryOf(query).fields).toEqual(
        expect.arrayContaining([
          'pulp_href',
          'name',
          'state',
          'pulp_created',
          'reserved_resources_record',
        ]),
      );
      expect(query.has('reserved_resources__in')).toBe(false);
      expect(query.has('reserved_resources')).toBe(false);
    }
    expect(lastTaskOf(result.current, REPOSITORY)?.pulp_href).toBe(
      done.pulp_href,
    );
    expect(lastTaskOf(result.current, OTHER)?.state).toBe('running');
  });

  it('sends exactly two task requests however many lists are mounted', async () => {
    const { handler, queries } = taskListHandler([done, running]);
    server.use(handler);
    const client = createTestQueryClient();

    const first = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(client),
    });
    const second = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(client),
    });
    const third = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(client),
    });

    await waitFor(() => {
      for (const view of [first, second, third]) {
        expect(view.result.current.state).toBe('ready');
      }
    });
    expect(queries).toHaveLength(2);
  });

  it('reads every page of the waiting and running tasks', async () => {
    const busy = Array.from({ length: 5 }, (_, day) =>
      taskOf(day + 1, 'running', [REPOSITORY]),
    );
    const { handler, queries } = taskListHandler(busy, { pageSize: 2 });
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(queries.filter(ACTIVE).map((q) => q.get('offset'))).toEqual([
      '0',
      '2',
      '4',
    ]);
    expect(result.current.tasks).toHaveLength(5);
  });

  it('is an error state, not an empty answer, when a read fails, and reads again on retry', async () => {
    let failing = true;
    const { handler } = taskListHandler([done]);
    server.use(
      http.get(`*${TASKS}`, (info) => {
        if (
          failing &&
          !new URL(info.request.url).searchParams.has('state__in')
        ) {
          return HttpResponse.json({ detail: 'boom' }, { status: 500 });
        }
        return undefined;
      }),
      handler,
    );

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(lastTaskOf(result.current, REPOSITORY)).toBeNull();

    failing = false;
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(lastTaskOf(result.current, REPOSITORY)?.pulp_href).toBe(
      done.pulp_href,
    );
  });

  it('reads again every 10 seconds only while a task is waiting or running', async () => {
    const rows = [done, running];
    const { handler, queries } = taskListHandler(rows);
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(queries).toHaveLength(2);

    intervals.run(INDEX_POLL_MS);
    await waitFor(() => expect(queries).toHaveLength(4));

    // the running task finishes: the next read shows it, and then the reads stop
    rows[1] = { ...running, state: 'completed' };
    intervals.run(INDEX_POLL_MS);
    await waitFor(() =>
      expect(lastTaskOf(result.current, OTHER)?.state).toBe('completed'),
    );
    expect(queries).toHaveLength(6);

    intervals.run(INDEX_POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(queries).toHaveLength(6);
  });

  it('never reads again by itself while nothing is waiting or running', async () => {
    const { handler, queries } = taskListHandler([done]);
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));

    intervals.run(INDEX_POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queries).toHaveLength(2);
  });

  it('does not read again while the browser tab is hidden', async () => {
    const { handler, queries } = taskListHandler([done, running]);
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(queries).toHaveLength(2);

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    intervals.run(INDEX_POLL_MS);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(queries).toHaveLength(2);
  });
});
