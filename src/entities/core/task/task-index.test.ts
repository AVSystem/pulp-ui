import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { type ITaskRow, taskListHandler, taskRow } from 'src/test-utils/pulp';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { taskKeys } from './queries';
import {
  ACTIVE_POLL_MS,
  INDEX_POLL_MS,
  buildTaskIndex,
  lastTaskOf,
  useActiveTaskOf,
  useLastSyncOf,
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
    const busy = Array.from({ length: 1005 }, (_, number) =>
      taskOf(1, 'running', [`prn:file.filerepository:${number}`]),
    );
    const { handler, queries } = taskListHandler(busy);
    server.use(handler);

    const { result } = renderHook(() => useTaskIndex(), {
      wrapper: wrapperFor(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(queries.filter(ACTIVE).map((q) => q.get('offset'))).toEqual([
      '0',
      '1000',
    ]);
    expect(result.current.tasks).toHaveLength(1005);
    expect(
      lastTaskOf(result.current, 'prn:file.filerepository:1004')?.pulp_href,
    ).toBe(busy[1004].pulp_href);
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

const REPOSITORY_HREF = '/pulp/api/v3/repositories/file/file/11111111/';
const SYNC = 'pulp_file.app.tasks.synchronizing.synchronize';
const PUBLISH = 'pulp_file.app.tasks.publishing.publish';

// The tasks of one repository, whose address the server turns into its PRN.
const PRNS = { [REPOSITORY_HREF]: REPOSITORY };

describe(
  'Integration: the tasks of one repository',
  { tags: ['integration'] },
  () => {
    let intervals: IIntervals;

    beforeEach(() => {
      intervals = trackIntervals();
    });

    afterEach(() => {
      intervals.restore();
    });

    const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

    describe('useActiveTaskOf', () => {
      const running = taskOf(3, 'running', [REPOSITORY], { name: SYNC });
      const waiting = taskOf(4, 'waiting', [REPOSITORY], { name: PUBLISH });
      const finished = taskOf(5, 'completed', [REPOSITORY], { name: SYNC });

      it('asks for the newest waiting or running task that reserves the repository, one row', async () => {
        const { handler, queries } = taskListHandler(
          [running, waiting, finished],
          { prns: PRNS },
        );
        server.use(handler);

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(createTestQueryClient()),
        });

        await waitFor(() =>
          expect(result.current.data?.pulp_href).toBe(waiting.pulp_href),
        );
        expect(queries).toHaveLength(1);
        expect(Object.fromEntries(queries[0])).toEqual({
          reserved_resources: REPOSITORY_HREF,
          state__in: 'waiting,running',
          ordering: '-pulp_created',
          limit: '1',
          offset: '0',
        });
      });

      it('answers null, not nothing, when no task is active', async () => {
        const { handler } = taskListHandler([finished], { prns: PRNS });
        server.use(handler);

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(createTestQueryClient()),
        });

        await waitFor(() => expect(result.current.data).toBeNull());
      });

      it('sends nothing for a repository that is not known', async () => {
        const { handler, queries } = taskListHandler([running]);
        server.use(handler);

        renderHook(() => useActiveTaskOf(null), {
          wrapper: wrapperFor(createTestQueryClient()),
        });
        await settle();

        expect(queries).toEqual([]);
      });

      it('asks again every 5 seconds while the page is open and shows the task end', async () => {
        const rows = [running];
        const { handler, queries } = taskListHandler(rows, { prns: PRNS });
        server.use(handler);

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(createTestQueryClient()),
        });
        await waitFor(() =>
          expect(result.current.data?.pulp_href).toBe(running.pulp_href),
        );

        intervals.run(ACTIVE_POLL_MS);
        await waitFor(() => expect(queries).toHaveLength(2));

        rows[0] = { ...running, state: 'completed' };
        intervals.run(ACTIVE_POLL_MS);
        await waitFor(() => expect(result.current.data).toBeNull());

        // nothing is active, but the page stays open: the next start is seen
        rows[0] = { ...running, state: 'waiting' };
        intervals.run(ACTIVE_POLL_MS);
        await waitFor(() =>
          expect(result.current.data?.pulp_href).toBe(running.pulp_href),
        );
      });

      it.each([403, 404])(
        'stops asking when the server answers %i',
        async (status) => {
          let answers = 0;
          const { handler } = taskListHandler([running], { prns: PRNS });
          server.use(
            http.get(`*${TASKS}`, () => {
              answers++;
              return answers > 1
                ? HttpResponse.json({ detail: 'no' }, { status })
                : undefined;
            }),
            handler,
          );

          const { result } = renderHook(
            () => useActiveTaskOf(REPOSITORY_HREF),
            { wrapper: wrapperFor(createTestQueryClient()) },
          );
          await waitFor(() => expect(result.current.data).toBeTruthy());

          intervals.run(ACTIVE_POLL_MS);
          await waitFor(() => expect(answers).toBe(2));
          intervals.run(ACTIVE_POLL_MS);
          await settle();

          expect(answers).toBe(2);
        },
      );

      it('does not poll after a first read that failed', async () => {
        let answers = 0;
        server.use(
          http.get(`*${TASKS}`, () => {
            answers++;
            return HttpResponse.json({ detail: 'boom' }, { status: 500 });
          }),
        );

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(createTestQueryClient()),
        });
        await waitFor(() => expect(result.current.isError).toBe(true));

        intervals.run(ACTIVE_POLL_MS);
        await settle();

        expect(answers).toBe(1);
      });

      it('does not poll while the browser tab is hidden', async () => {
        const { handler, queries } = taskListHandler([running], {
          prns: PRNS,
        });
        server.use(handler);

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(createTestQueryClient()),
        });
        await waitFor(() => expect(result.current.data).toBeTruthy());

        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        });
        try {
          intervals.run(ACTIVE_POLL_MS);
          await settle();
        } finally {
          Reflect.deleteProperty(document, 'visibilityState');
        }

        expect(queries).toHaveLength(1);
      });
    });

    describe('useLastSyncOf', () => {
      const oldSync = taskOf(2, 'failed', [REPOSITORY], { name: SYNC });
      const newSync = taskOf(4, 'completed', [REPOSITORY], { name: SYNC });
      const publish = taskOf(6, 'completed', [REPOSITORY], { name: PUBLISH });

      it('asks for the newest task of the sync name that reserves the repository, once', async () => {
        const { handler, queries } = taskListHandler(
          [oldSync, newSync, publish],
          { prns: PRNS },
        );
        server.use(handler);

        const { result } = renderHook(
          () => useLastSyncOf(REPOSITORY_HREF, SYNC),
          { wrapper: wrapperFor(createTestQueryClient()) },
        );

        await waitFor(() =>
          expect(result.current.data?.pulp_href).toBe(newSync.pulp_href),
        );
        intervals.run(ACTIVE_POLL_MS);
        intervals.run(INDEX_POLL_MS);
        await settle();

        expect(queries).toHaveLength(1);
        expect(Object.fromEntries(queries[0])).toEqual({
          reserved_resources: REPOSITORY_HREF,
          name: SYNC,
          ordering: '-pulp_created',
          limit: '1',
          offset: '0',
        });
      });

      it('answers null when the repository was never synced', async () => {
        const { handler } = taskListHandler([publish], { prns: PRNS });
        server.use(handler);

        const { result } = renderHook(
          () => useLastSyncOf(REPOSITORY_HREF, SYNC),
          { wrapper: wrapperFor(createTestQueryClient()) },
        );

        await waitFor(() => expect(result.current.data).toBeNull());
      });

      it('sends nothing for a repository or a task name that is not known', async () => {
        const { handler, queries } = taskListHandler([newSync]);
        server.use(handler);
        const wrapper = wrapperFor(createTestQueryClient());

        renderHook(() => useLastSyncOf(null, SYNC), { wrapper });
        renderHook(() => useLastSyncOf(REPOSITORY_HREF, null), { wrapper });
        await settle();

        expect(queries).toEqual([]);
      });

      it('reads again once the sync that was watched has ended', async () => {
        const rows = [oldSync, { ...newSync, state: 'running' }];
        const { handler, queries } = taskListHandler(rows, { prns: PRNS });
        server.use(handler);

        const { result } = renderHook(
          () => ({
            active: useActiveTaskOf(REPOSITORY_HREF),
            last: useLastSyncOf(REPOSITORY_HREF, SYNC),
          }),
          { wrapper: wrapperFor(createTestQueryClient()) },
        );
        await waitFor(() => {
          expect(result.current.active.data?.state).toBe('running');
          expect(result.current.last.data?.state).toBe('running');
        });
        const before = queries.length;

        rows[1] = { ...newSync, state: 'completed' };
        intervals.run(ACTIVE_POLL_MS);

        await waitFor(() => {
          expect(result.current.active.data).toBeNull();
          expect(result.current.last.data?.state).toBe('completed');
        });
        // one read of the active task and one of the last sync
        expect(queries.length).toBe(before + 2);
      });

      it('marks the task index old when a watched sync ends, so a list shows the end', async () => {
        const rows = [{ ...newSync, state: 'running' }];
        const { handler } = taskListHandler(rows, { prns: PRNS });
        server.use(handler);
        const client = createTestQueryClient();
        client.setQueryData(taskKeys.index, { active: [], recent: [] });

        const { result } = renderHook(() => useActiveTaskOf(REPOSITORY_HREF), {
          wrapper: wrapperFor(client),
        });
        await waitFor(() => expect(result.current.data).toBeTruthy());
        expect(client.getQueryState(taskKeys.index)?.isInvalidated).toBe(false);

        rows[0] = { ...newSync, state: 'completed' };
        intervals.run(ACTIVE_POLL_MS);
        await waitFor(() => expect(result.current.data).toBeNull());

        expect(client.getQueryState(taskKeys.index)?.isInvalidated).toBe(true);
      });
    });
  },
);
