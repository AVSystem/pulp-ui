import {
  type QueryClient,
  skipToken,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { groupHref, groupUrlId } from 'src/entities/core/group/href';
import { userHref, userUrlId } from 'src/entities/core/user/href';
import { useUser } from 'src/entities/core/user/queries';
import { useSessionQuery } from 'src/query/use-session-query';
import { useUserContext } from 'src/user-context';
import { RoleAssignmentClient } from './client';
import {
  type ObjectGrants,
  type RoleOwner,
  addAssignments,
  objectPermissionIndex,
} from './model';

const all = ['pulp', 'core', 'role-assignment'] as const;

export const roleAssignmentKeys = {
  all,
  // What each role allows, by the role's name.
  rolePermissions: [...all, 'role-permissions'] as const,
  // The roles the user holds on single objects, read in full. One user is one
  // index, so a session that changes account reads the new user's own.
  objectIndex: (user: string) => [...all, 'object-index', user] as const,
  // What has been read of that index so far, written page by page.
  progress: (user: string) =>
    [...all, 'object-index', user, 'progress'] as const,
};

// How many pages of one owner's roles are read at the same time. The server
// has few workers and the rows of the screen are read at the same moment, so
// the index takes only a small share.
const PAGES_IN_FLIGHT = 2;

// The latest read of each index query. A read that was started before another
// one for the same entry (a retry) must not write over the newer one.
const latestRun = new WeakMap<object, symbol>();

interface Progress {
  grants: ObjectGrants;
  pages: number;
}

// Reads every role the user and their groups hold, page by page. Each page that
// arrives is added to the answer and published through the progress entry, so
// the objects found so far can be answered while the rest is read. The first
// page of an owner is read alone to learn how many pages follow; the others
// are read two at a time. The first failure stops further pages and rejects:
// a partial answer is never taken for the whole one. The read goes on when the
// screen that started it is gone, because the answer is for the session; it
// stops when its entry has been removed from the cache (another account) or
// has been read again since.
async function readIndex(
  queryClient: QueryClient,
  user: string,
  groups: string[],
): Promise<ObjectGrants> {
  const cache = queryClient.getQueryCache();
  const key = roleAssignmentKeys.objectIndex(user);
  const self = cache.find({ queryKey: key, exact: true });
  const run = Symbol('index read');
  if (self) {
    latestRun.set(self, run);
  }
  const alive = () =>
    self !== undefined &&
    cache.find({ queryKey: key, exact: true }) === self &&
    latestRun.get(self) === run;

  const grants: ObjectGrants = new Map();
  let pages = 0;
  let failed = false;

  const publish = () => {
    if (alive()) {
      queryClient.setQueryData<Progress>(roleAssignmentKeys.progress(user), {
        grants,
        pages,
      });
    }
  };
  publish();

  const take = async (owner: RoleOwner, offset: number) => {
    const read = await RoleAssignmentClient.page(owner, offset);
    addAssignments(grants, read.results);
    pages++;
    publish();
    return read;
  };

  const readOwner = async (owner: RoleOwner) => {
    const first = await take(owner, 0);
    const step = first.results.length;
    const offsets: number[] = [];
    for (let at = step; step > 0 && at < first.count; at += step) {
      offsets.push(at);
    }

    let next = 0;
    const worker = async () => {
      while (next < offsets.length && !failed && alive()) {
        await take(owner, offsets[next++]);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(PAGES_IN_FLIGHT, offsets.length) }, worker),
    );
  };

  const owners: RoleOwner[] = [
    { kind: 'user', href: user },
    ...groups.map((href): RoleOwner => ({ kind: 'group', href })),
  ];
  try {
    await Promise.all(owners.map(readOwner));
  } catch (error) {
    failed = true;
    throw error;
  }
  return grants;
}

// What the user may do on single objects, as far as it is known.
export interface ObjectPermissions {
  // `loading`: the reads are not complete, so an object that is not found yet
  // may still be found. `error`: a read failed; `retry` asks again. `ready`:
  // every role has been read.
  state: 'loading' | 'ready' | 'error';
  // Whether a role the user holds, themselves or through a group, on exactly
  // this object allows the permission. False for everything that is not known
  // (yet), so an action is never offered on a guess; it may turn true while
  // pages are still arriving. A role held on every object is not answered
  // here: it belongs to the global permissions. An account the permission
  // provider counts as staff holds everything, as there. This is for showing
  // or hiding an action only; the server decides every request.
  can: (object: string | null | undefined, permission: string) => boolean;
  // Reads again what failed.
  retry: () => void;
}

const NOTHING = (): boolean => false;
const EVERYTHING = (): boolean => true;

// The groups of the user's own record, by address, each once.
function groupsOf(
  groups:
    | readonly { id?: number | null; pulp_href?: string | null }[]
    | null
    | undefined,
): string[] {
  const hrefs = (groups ?? []).flatMap((group) => {
    const id =
      groupUrlId(group.pulp_href) ?? (group.id ? String(group.id) : null);
    const href = groupHref(id);
    return href ? [href] : [];
  });
  return Array.from(new Set(hrefs));
}

// The roles the signed-in user holds on single objects, from their own roles
// and those of their groups, for the screens that decide per row which actions
// to offer without a request per row. The user's own record is the one the
// permission provider reads (shared through the cache). The roles are read
// once per session in pages of the role name and the object only, with the
// permissions of each role taken from one read of the catalogue of roles, and
// kept for the session. With `enabled` false nothing is read: a list passes
// true once its rows are shown, so these reads come behind the rows and never
// in front of them.
export function useObjectPermissions({
  enabled = true,
}: { enabled?: boolean } = {}): ObjectPermissions {
  const queryClient = useQueryClient();
  const { user: session } = useUserContext();
  const own = userHref(userUrlId(session?.pulp_href));

  const record = useUser(enabled ? own : null);
  const staff = record.data?.is_staff === true;
  const ready = enabled && own !== null && record.data !== undefined && !staff;
  const groups = useMemo(() => groupsOf(record.data?.groups), [record.data]);

  const catalogue = useSessionQuery({
    queryKey: roleAssignmentKeys.rolePermissions,
    queryFn: ({ signal }) => RoleAssignmentClient.rolePermissions({ signal }),
    enabled: ready,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const index = useSessionQuery({
    queryKey: roleAssignmentKeys.objectIndex(own ?? ''),
    queryFn: () => readIndex(queryClient, own as string, groups),
    enabled: ready,
    staleTime: Infinity,
    gcTime: Infinity,
    // A page that fails ends the read; the user asks again with Retry, and the
    // pages already read are not asked for twice by a retry of one request.
    retry: false,
  });

  // What the pages read so far hold. Written by the read itself, one entry per
  // page, so a screen can answer from it while the read goes on.
  const progress = useQuery<Progress | undefined>({
    queryKey: roleAssignmentKeys.progress(own ?? ''),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;

  const answer = useMemo(
    () =>
      progress && catalogue.data
        ? objectPermissionIndex(progress.grants, catalogue.data)
        : NOTHING,
    [progress, catalogue.data],
  );

  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      predicate: (query) =>
        query.state.status === 'error' &&
        [
          roleAssignmentKeys.rolePermissions,
          roleAssignmentKeys.objectIndex(own ?? ''),
        ].some((key) =>
          key.every((part, position) => query.queryKey[position] === part),
        ),
    });
    if (record.isError) {
      void record.refetch();
    }
  }, [own, queryClient, record]);

  if (staff) {
    return { state: 'ready', can: EVERYTHING, retry };
  }
  const failed = [record, catalogue, index].some(
    (read) => read.isError && !read.isFetching,
  );
  const state = failed
    ? 'error'
    : catalogue.isSuccess && index.isSuccess
      ? 'ready'
      : 'loading';

  return { state, can: answer, retry };
}
