import { useQueries } from '@tanstack/react-query';
import { useSessionEnded } from 'src/session/session-events';
import { ResourceClient } from './client';

export const resourceKeys = {
  all: ['pulp', 'core', 'resource'] as const,
  detail: (href: string) => [...resourceKeys.all, 'detail', href] as const,
};

// The resources of a task, one read for each address. A resource is read once
// per visit: its name does not change while a task is polled, so a poll never
// reads it again. A read that fails leaves its resource without a name and is
// not repeated by itself. While the session has ended nothing is sent.
export function useResources(hrefs: string[]) {
  const { ended } = useSessionEnded();

  return useQueries({
    queries: hrefs.map((href) => ({
      queryKey: resourceKeys.detail(href),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        ResourceClient.retrieve(href, { signal }),
      staleTime: Infinity,
      enabled: !ended,
    })),
  });
}
