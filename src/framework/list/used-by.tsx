import { t } from '@lingui/core/macro';
import { Skeleton } from '@patternfly/react-core';
import { useMemo } from 'react';
import { Link } from 'react-router';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useRepositoryIndex } from 'src/entities/plugin/queries';
import type { Options } from 'src/entities/plugin/request';
import { isSessionEnd } from 'src/utilities/request-error';
import type { FrameworkPlugin } from '../manifest';
import { repositoryListPath, repositoryPath } from '../route-patterns';
import type { ColumnState } from './derived-columns';

// The repositories that use a remote, found from the one read of the plugin's
// repositories that every screen of the plugin shares. A cell holds no request:
// the list reads the index once and hands each row the repositories of its
// remote, so the number of requests does not grow with the rows.

// What a screen needs of the repository entity to find the repositories of each
// remote.
interface IndexedEntity {
  readonly app: string;
  readonly object: string;
  index: (options?: Options) => Promise<RepositoryBase[]>;
}

export interface UsingRepository {
  pulp_href: string;
  name: string;
}

export interface UsedByIndex {
  state: ColumnState;
  error: unknown;
  retry: () => void;
  // The repositories that use the remote at this address, by name.
  of: (remote: string) => readonly UsingRepository[];
}

const NONE: readonly UsingRepository[] = [];

// Groups the repositories of the plugin by the remote they use. The read starts
// only when `enabled` is true, so a list that has no rows yet reads nothing.
export function useUsedBy(
  entity: IndexedEntity,
  { enabled = true }: { enabled?: boolean } = {},
): UsedByIndex {
  const index = useRepositoryIndex(entity, { enabled });

  const byRemote = useMemo(() => {
    const groups = new Map<string, UsingRepository[]>();
    for (const { pulp_href, name, remote } of index.data ?? []) {
      if (remote) {
        groups.set(remote, [
          ...(groups.get(remote) ?? []),
          { pulp_href, name },
        ]);
      }
    }
    groups.forEach((users) =>
      users.sort((a, b) => a.name.localeCompare(b.name)),
    );
    return groups;
  }, [index.data]);

  let state: ColumnState = 'loading';
  if (index.data) {
    state = 'ready';
  } else if (index.isError && !isSessionEnd(index.error)) {
    state = 'error';
  }

  return {
    state,
    error: index.error,
    retry: () => void index.refetch(),
    of: (remote) => byRemote.get(remote) ?? NONE,
  };
}

interface CellProps {
  plugin: FrameworkPlugin;
  // The address of the remote the cell is about.
  remote: string;
  state: ColumnState;
  users: readonly UsingRepository[];
  // How many repositories use the remote in all, when `users` holds only the
  // first of them.
  total?: number;
  // How many repositories are named before the rest are counted.
  limit?: number;
}

// The first repositories that use a remote, linked to their pages, and a link
// to the list of repositories filtered by the remote for the rest.
export const UsedBy = ({
  plugin,
  remote,
  state,
  users,
  total = users.length,
  limit = 3,
}: CellProps) => {
  if (state === 'loading') {
    return <Skeleton width='70%' />;
  }
  if (state !== 'ready') {
    return <>{t`Not loaded`}</>;
  }
  if (total === 0) {
    return <>{t`Not used`}</>;
  }

  const more = total - Math.min(limit, users.length);

  return (
    <>
      {users.slice(0, limit).map(({ pulp_href, name }, position) => (
        <span key={pulp_href}>
          {position > 0 ? ', ' : ''}
          <Link to={repositoryPath(plugin, name)}>{name}</Link>
        </span>
      ))}
      {more > 0 ? (
        <>
          {' '}
          <Link
            to={`${repositoryListPath(plugin)}?remote=${encodeURIComponent(remote)}`}
          >
            {t`+${more} more`}
          </Link>
        </>
      ) : null}
    </>
  );
};
