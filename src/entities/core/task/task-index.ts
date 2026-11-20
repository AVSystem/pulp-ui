import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSessionQuery } from 'src/query/use-session-query';
import { requestErrorStatus } from 'src/utilities/request-error';
import { TaskClient } from './client';
import { type Task, isFinalState } from './model';
import { taskKeys } from './queries';

// How often the index is read again while it holds a task that has not
// finished.
export const INDEX_POLL_MS = 10_000;

// How often the active task of a repository is looked up again while a page
// that shows it is open.
export const ACTIVE_POLL_MS = 5_000;

// How long a read of the index is taken as current.
const INDEX_STALE_MS = 15_000;

// The most tasks one request of the index asks for. The server answers at most
// this many rows per page.
const INDEX_PAGE = 1000;

// What the index needs of a task: the address, the name and state a row is
// shown by, when it was made and ended, and what it reserved. The error and
// the progress of a task are read from the task itself.
const INDEX_FIELDS = [
  'pulp_href',
  'name',
  'state',
  'pulp_created',
  'started_at',
  'finished_at',
  'reserved_resources_record',
];

// What the tasks of the index say, ready to be asked about one repository.
export interface TaskIndex {
  // `loading`: a read has not answered yet. `error`: a read failed and the
  // answers below may be incomplete; `retry` asks again. `ready`: both reads
  // answered.
  state: 'loading' | 'ready' | 'error';
  // Every task the two reads returned, once each.
  tasks: readonly Task[];
  // The newest task that reserves each object, by the object's PRN.
  newest: ReadonlyMap<string, Task>;
  // Reads again what failed.
  retry: () => void;
}

// The PRN a record entry names. A shared reservation carries the prefix
// `shared:`; any other entry is the PRN itself.
function prnOf(entry: string): string {
  return entry.startsWith('shared:') ? entry.slice('shared:'.length) : entry;
}

// Whether the first task is newer than the second. Creation times are UTC
// timestamps of one format, so the text orders them. When two tasks were made
// at the same moment the one that has not finished counts as newer, because a
// row that says "running" must not be hidden by a finished sibling.
function isNewer(candidate: Task, current: Task): boolean {
  const a = candidate.pulp_created ?? '';
  const b = current.pulp_created ?? '';
  if (a !== b) {
    return a > b;
  }
  return isFinalState(current.state) && !isFinalState(candidate.state);
}

// Puts the two reads into one index. A task both reads returned is kept once,
// as the read of the waiting and running tasks has it: that read is the exact
// one, the other may be a moment older.
export function buildTaskIndex(
  active: readonly Task[],
  recent: readonly Task[],
): Pick<TaskIndex, 'tasks' | 'newest'> {
  const byAddress = new Map<string, Task>();
  for (const task of recent) {
    byAddress.set(task.pulp_href, task);
  }
  for (const task of active) {
    byAddress.set(task.pulp_href, task);
  }
  const tasks = Array.from(byAddress.values());

  const newest = new Map<string, Task>();
  for (const task of tasks) {
    for (const entry of task.reserved_resources_record ?? []) {
      const prn = prnOf(entry);
      const known = newest.get(prn);
      if (known === undefined || isNewer(task, known)) {
        newest.set(prn, task);
      }
    }
  }

  return { tasks, newest };
}

// The last task of the repository with this PRN: the newest task that reserved
// it, exclusively or shared, among the tasks the index holds. Null when the
// index holds none, which is "no recent task" and never "never synced".
export function lastTaskOf(
  index: Pick<TaskIndex, 'newest'>,
  prn: string | null | undefined,
): Task | null {
  return prn ? (index.newest.get(prn) ?? null) : null;
}

// What the index query holds: the two reads, as they were answered.
interface IndexReads {
  active: Task[];
  recent: Task[];
}

// Whether either read holds a task that has not finished, which is when the
// index is worth reading again. The read of the recent tasks counts too: a
// task it still shows as running may have ended since the other read.
function holdsUnfinishedTask(reads: IndexReads | undefined): boolean {
  return (
    reads !== undefined &&
    (reads.active.length > 0 ||
      reads.recent.some((task) => !isFinalState(task.state)))
  );
}

// The two global reads of tasks every list of repositories shares, held under
// one key: all the waiting and running tasks, page after page, and the newest
// 1000 tasks, with the fields the last task column needs, sent together. The tasks of a repository are never
// asked for one repository at a time: the server combines the values of
// `reserved_resources__in` with AND, so a set of repositories would match
// nothing, and a read per row would grow with the page. However many lists
// are mounted, the two reads are sent once and shared.
//
// The reads repeat every few seconds while a task that has not finished is
// held, never in a hidden tab, and stop at a refusal. A task started after the
// last read shows up when the keys under `taskKeys.index` are invalidated.
export function useTaskIndex(): TaskIndex {
  const queryClient = useQueryClient();

  const reads = useSessionQuery({
    queryKey: taskKeys.index,
    queryFn: async ({ signal }): Promise<IndexReads> => {
      const [active, recent] = await Promise.all([
        TaskClient.listEvery(
          {
            state__in: 'waiting,running',
            sort: '-pulp_created',
            page_size: INDEX_PAGE,
            fields: INDEX_FIELDS,
          },
          { signal },
        ),
        TaskClient.list(
          {
            sort: '-pulp_created',
            page_size: INDEX_PAGE,
            fields: INDEX_FIELDS,
          },
          { signal },
        ),
      ]);
      return { active, recent: recent.results };
    },
    staleTime: INDEX_STALE_MS,
    refetchInterval: (query) =>
      requestErrorStatus(query.state.error) === 403
        ? false
        : holdsUnfinishedTask(query.state.data)
          ? INDEX_POLL_MS
          : false,
    refetchIntervalInBackground: false,
  });

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: taskKeys.index,
      predicate: (query) => query.state.status === 'error',
    });
  }, [queryClient]);

  const built = useMemo(
    () => buildTaskIndex(reads.data?.active ?? [], reads.data?.recent ?? []),
    [reads.data],
  );

  // A read that failed is an error until it has been asked again, even though
  // the answer before it is still held.
  const state =
    reads.isError && !reads.isFetching
      ? 'error'
      : reads.data === undefined
        ? 'loading'
        : 'ready';

  return { state, ...built, retry };
}

// Whether the lookup of a repository's active task should be left alone: its
// first read failed and the screen waits for the user to ask again, or it was
// refused or the repository is gone. A later poll that fails for another
// reason on a lookup that has an answer is tried again. A lookup has no final
// state of its own: "no active task" is an answer that is asked again, so the
// start of the next task is seen.
function stopsLookup(state: { data: unknown; error: unknown }): boolean {
  if (!state.error) {
    return false;
  }
  const status = requestErrorStatus(state.error);
  return state.data === undefined || status === 403 || status === 404;
}

// The waiting or running task that reserves one object, or null when there is
// none, read again every few seconds while the page is open and in view. A
// null address is the address of nothing: no request is sent. When the task
// that was active is no longer the active one, it has ended: the last sync of
// the object and the task index are read again, so what they show is never
// older than the end of the task.
export function useActiveTaskOf(href: string | null) {
  const queryClient = useQueryClient();

  return useSessionQuery({
    queryKey: taskKeys.activeOf(href ?? ''),
    queryFn: async ({ signal }): Promise<Task | null> => {
      const target = href as string;
      const before = queryClient.getQueryData<Task | null>(
        taskKeys.activeOf(target),
      );
      const page = await TaskClient.list(
        {
          reserved_resources: target,
          state__in: 'waiting,running',
          sort: '-pulp_created',
          page_size: 1,
        },
        { signal },
      );
      const now = page.results[0] ?? null;

      if (before && before.pulp_href !== now?.pulp_href) {
        void queryClient.invalidateQueries({
          queryKey: taskKeys.lastOf(target),
        });
        void queryClient.invalidateQueries({ queryKey: taskKeys.index });
      }
      return now;
    },
    enabled: href !== null,
    staleTime: 0,
    refetchInterval: (query) =>
      stopsLookup(query.state) ? false : ACTIVE_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

// The newest task of one name that reserves one object (the last sync of a
// repository, for the task name of its plugin's sync), or null when there is
// none. Read once; it is read again when the active task of the object ends
// (see useActiveTaskOf) or when its keys are invalidated. A null address or
// name is the address of nothing: no request is sent.
export function useLastSyncOf(href: string | null, taskName: string | null) {
  return useSessionQuery({
    queryKey: taskKeys.lastNamedOf(href ?? '', taskName ?? ''),
    queryFn: async ({ signal }): Promise<Task | null> => {
      const page = await TaskClient.list(
        {
          reserved_resources: href as string,
          name: taskName as string,
          sort: '-pulp_created',
          page_size: 1,
        },
        { signal },
      );
      return page.results[0] ?? null;
    },
    enabled: href !== null && taskName !== null,
  });
}
