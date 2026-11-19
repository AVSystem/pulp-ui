import { QueryClient } from '@tanstack/react-query';
import { ResponseShapeError } from 'src/entities/response-shape';
import { isSessionEnd, requestErrorStatus } from 'src/utilities/request-error';

// Whether a failed read is sent again by itself. A refusal, a missing object,
// a request held back while the session has ended and an answer of the wrong
// shape give the same result the next time, so they fail at once and the user
// decides about a retry. Anything else (a dropped connection, a server error)
// is tried again twice. A write is never repeated: mutations do not use this
// policy.
export function retryPolicy(failureCount: number, error: unknown): boolean {
  if (isSessionEnd(error) || error instanceof ResponseShapeError) {
    return false;
  }
  const status = requestErrorStatus(error);
  if (status !== null && status >= 400 && status < 500) {
    return false;
  }
  return failureCount < 2;
}

// The client of the application: one per page load, shared by every screen.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Screens read on mount; a read that is less than half a minute old is
        // shown as it is instead of being asked for again.
        staleTime: 30_000,
        // Returning to the tab is checked by the session code, which asks who
        // is signed in; a read on every focus would race that check.
        refetchOnWindowFocus: false,
        // A failed read is a state the screen renders (an error state with a
        // retry), never an exception that unmounts it.
        throwOnError: false,
        retry: retryPolicy,
      },
    },
  });
}
