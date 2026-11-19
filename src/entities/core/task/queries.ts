import {
  type Query,
  useMutation,
  useQueries,
  useQueryClient,
} from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { useSessionEnded } from 'src/session/session-events';
import { requestErrorStatus } from 'src/utilities/request-error';
import { TaskClient } from './client';
import {
  type Task,
  type TaskCountFilter,
  type TaskListParams,
  isFinalState,
} from './model';

// How often a task that has not finished is read again.
export const TASK_POLL_MS = 10_000;

const all = ['pulp', 'core', 'task'] as const;

export const taskKeys = {
  all,
  list: (params: TaskListParams) => [...all, 'list', params] as const,
  detail: (href: string) => [...all, 'detail', href] as const,
  // Every count of tasks, for the one invalidation that reads them all again.
  counts: [...all, 'count'] as const,
  count: (filter: TaskCountFilter) => [...all, 'count', filter] as const,
};

// How a read of tasks behaves beyond its parameters.
export interface TaskReadOptions {
  // False keeps the read off, for a screen that has nobody to read for.
  enabled?: boolean;
  // Reads again this often while the page is in view, never in a hidden tab.
  refetchInterval?: number;
}

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads. The same page of the same list is not
// a stand-in but the same read: when the cache was emptied for another account
// the previous rows belong to the account that left and are never shown.
function otherPageOfSameList(a: TaskListParams, b: TaskListParams): boolean {
  return (
    a.page !== b.page &&
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.name__contains === b.name__contains &&
    a.state === b.state &&
    a.state__in === b.state__in &&
    a.finishedWithinMs === b.finishedWithinMs
  );
}

// One page of tasks. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads, the rows of the page before stay; rows that were read
// for other filters or another order are never shown in their place. A read
// that is repeated stops at a refusal: asking again would be refused again.
export function useTasks(
  params: TaskListParams,
  options: TaskReadOptions = {},
) {
  const { enabled, refetchInterval } = options;

  return useSessionQuery({
    queryKey: taskKeys.list(params),
    queryFn: ({ signal }) => TaskClient.list(params, { signal }),
    enabled,
    refetchInterval:
      refetchInterval === undefined
        ? undefined
        : (query) =>
            requestErrorStatus(query.state.error) === 403
              ? false
              : refetchInterval,
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as TaskListParams | undefined;
      return before && otherPageOfSameList(before, params)
        ? previous
        : undefined;
    },
  });
}

// Whether a task that is read again should be left alone: it has finished and
// no longer changes, it was refused or does not exist, or its first read
// failed and the screen waits for the user to ask again. A later poll that
// fails for another reason on a task that is shown is tried again.
function stopsPolling(query: Query<Task>): boolean {
  const { data, error } = query.state;
  if (data && isFinalState(data.state)) {
    return true;
  }
  if (!error) {
    return false;
  }
  const status = requestErrorStatus(error);
  return !data || status === 403 || status === 404;
}

// How a read of one task behaves beyond its address.
export interface TaskDetailOptions {
  // Reads again this often until the task has finished; false reads once.
  refetchInterval?: number | false;
  // How long a read of the task is taken as current.
  staleTime?: number;
}

// One task by its address, read again every few seconds until it has
// finished. A null address is the address of nothing: no request is sent. The
// query layer never starts a second read while one is running, so a first
// answer that is slow is waited for, not overtaken by the next poll.
export function useTask(href: string | null, options: TaskDetailOptions = {}) {
  const { refetchInterval = TASK_POLL_MS, staleTime } = options;

  return useSessionQuery({
    queryKey: taskKeys.detail(href ?? ''),
    queryFn: ({ signal }) => TaskClient.retrieve(href as string, { signal }),
    enabled: href !== null,
    ...(staleTime === undefined ? {} : { staleTime }),
    refetchInterval:
      refetchInterval === false
        ? false
        : (query) => (stopsPolling(query) ? false : refetchInterval),
  });
}

// The tasks a task points to (its parent and children), one read for each
// address, each read once per visit and never polled.
export function useRelatedTasks(hrefs: string[]) {
  const { ended } = useSessionEnded();

  return useQueries({
    queries: hrefs.map((href) => ({
      queryKey: taskKeys.detail(href),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        TaskClient.retrieve(href, { signal }),
      staleTime: Infinity,
      enabled: !ended,
    })),
  });
}

// How many tasks match the filter. After a failed read the query still holds
// the number of the read before; the caller decides whether to show it.
export function useTaskCount(
  filter: TaskCountFilter,
  options: Pick<TaskReadOptions, 'refetchInterval'> = {},
) {
  return useSessionQuery({
    queryKey: taskKeys.count(filter),
    queryFn: ({ signal }) => TaskClient.count(filter, { signal }),
    refetchInterval: options.refetchInterval,
  });
}

// Stops a task. Lists are read again once the server has answered, whether the
// task was stopped or not: either way the rows may have changed. The request
// is never repeated by itself.
export function useCancelTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (href: string) => TaskClient.cancel(href),
    onSettled: () => queryClient.invalidateQueries({ queryKey: taskKeys.all }),
  });
}
