import { useSessionQuery } from 'src/query/use-session-query';
import { SigningServiceClient } from './client';
import type { SigningServiceListParams } from './model';

export const signingServiceKeys = {
  all: ['pulp', 'core', 'signing-service'] as const,
  list: (params: SigningServiceListParams) =>
    [...signingServiceKeys.all, 'list', params] as const,
};

const SAME_LIST = ['sort', 'page_size', 'name'] as const;

// Whether two requests are pages of the same list: the same order, page size
// and filter.
function samePagesOfList(
  before: SigningServiceListParams,
  now: SigningServiceListParams,
): boolean {
  return SAME_LIST.every((key) => before[key] === now[key]);
}

// One page of the signing services. Every page, order and filter has a read of
// its own, so the answer to an earlier request is never the list of a later
// one, however late it arrives. While another page of the same list loads, the
// rows of the page before stay. A failure is the query's error; it is never an
// empty list.
export function useSigningServices(params: SigningServiceListParams) {
  return useSessionQuery({
    queryKey: signingServiceKeys.list(params),
    queryFn: ({ signal }) => SigningServiceClient.list(params, { signal }),
    staleTime: 30_000,
    placeholderData: (previous, previousQuery) => {
      const before = previousQuery?.queryKey[4] as
        SigningServiceListParams | undefined;

      return before && samePagesOfList(before, params) ? previous : undefined;
    },
  });
}
