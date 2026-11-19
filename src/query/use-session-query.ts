import {
  type DefaultError,
  type QueryKey,
  type UseQueryOptions,
  type UseQueryResult,
  useQuery,
} from '@tanstack/react-query';
import { useSessionEnded } from 'src/session/session-events';

// `useQuery` for a read that needs a session. While the session has ended and
// the sign-in dialog is open, the query starts no request: it would be held
// back or refused, and the dialog already explains why nothing loads. The
// query keeps the data it has, and it reads again when the same account
// signs in again (see SessionQueryBridge).
export function useSessionQuery<
  TQueryFnData = unknown,
  TError = DefaultError,
  TData = TQueryFnData,
  TQueryKey extends QueryKey = QueryKey,
>(
  options: UseQueryOptions<TQueryFnData, TError, TData, TQueryKey>,
): UseQueryResult<TData, TError> {
  const { ended } = useSessionEnded();

  return useQuery({
    ...options,
    enabled: ended ? false : options.enabled,
  });
}
