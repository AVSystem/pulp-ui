import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSessionQuery } from 'src/query/use-session-query';
import { TaskClient } from './client';
import type { TaskListParams } from './model';

export const taskKeys = {
  all: ['pulp', 'core', 'task'] as const,
  list: (params: TaskListParams) => [...taskKeys.all, 'list', params] as const,
  detail: (href: string) => [...taskKeys.all, 'detail', href] as const,
};

// Whether two lists differ in the page only, so the rows of the one are a fair
// stand-in for the other while it loads.
function samePageOfSameList(a: TaskListParams, b: TaskListParams): boolean {
  return (
    a.page_size === b.page_size &&
    a.sort === b.sort &&
    a.name__contains === b.name__contains &&
    a.state === b.state
  );
}

// One page of tasks. Every set of parameters is a query of its own, so an
// older answer never lands in the place of a newer one. While another page of
// the same list loads, the rows of the page before stay; rows that were read
// for other filters or another order are never shown in their place.
export function useTasks(params: TaskListParams) {
  return useSessionQuery({
    queryKey: taskKeys.list(params),
    queryFn: ({ signal }) => TaskClient.list(params, { signal }),
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as TaskListParams | undefined;
      return before && samePageOfSameList(before, params)
        ? previous
        : undefined;
    },
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
