import { useSessionQuery } from 'src/query/use-session-query';
import { StatusClient } from './client';

export const statusKeys = {
  all: ['pulp', 'core', 'status'] as const,
};

// The status of the server as the signed-in account (or the visitor) may see
// it. The abort signal of the query reaches the request.
export function useStatus() {
  return useSessionQuery({
    queryKey: statusKeys.all,
    queryFn: ({ signal }) => StatusClient.retrieve({ signal }),
  });
}
