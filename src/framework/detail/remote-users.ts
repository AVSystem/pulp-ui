import type { Page, RepositoryListParams } from 'src/entities/plugin/model';
import { useEntityList } from 'src/entities/plugin/queries';
import type { Options } from 'src/entities/plugin/request';
import { isSessionEnd } from 'src/utilities/request-error';
import type { ColumnState } from '../list/derived-columns';
import type { UsingRepository } from '../list/used-by';

// How many repositories one read of the users of a remote names. A remote used
// by more says how many more there are.
export const REMOTE_USERS_PAGE = 50;

interface ListedEntity {
  readonly app: string;
  readonly object: string;
  list: (
    params?: RepositoryListParams,
    options?: Options,
  ) => Promise<Page<UsingRepository>>;
}

export interface RemoteUsers {
  state: ColumnState;
  error: unknown;
  retry: () => void;
  // The first repositories that use the remote, by name.
  users: readonly UsingRepository[];
  // How many repositories use it in all.
  total: number;
}

const NONE: readonly UsingRepository[] = [];

// The repositories that use one remote, read with one request that the server
// filters by the remote's address. A screen that is about a single remote (its
// detail, its delete confirmation) reads this instead of the index of every
// repository of the plugin, which a list shares between its rows. Nothing is
// read while `enabled` is false.
export function useRemoteUsers(
  entity: ListedEntity,
  remote: string,
  { enabled = true }: { enabled?: boolean } = {},
): RemoteUsers {
  const query = useEntityList(
    entity,
    {
      remote,
      page_size: REMOTE_USERS_PAGE,
      sort: 'name',
      fields: ['pulp_href', 'name'],
    },
    { enabled },
  );

  let state: ColumnState = 'loading';
  if (query.data) {
    state = 'ready';
  } else if (query.isError && !isSessionEnd(query.error)) {
    state = 'error';
  }

  return {
    state,
    error: query.error,
    retry: () => void query.refetch(),
    users: query.data?.results ?? NONE,
    total: query.data?.count ?? 0,
  };
}
