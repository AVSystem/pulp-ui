import { useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UserClient } from './entities/core/user/client';
import { userHref, userUrlId } from './entities/core/user/href';
import { userKeys } from './entities/core/user/queries';
import { useUserContext } from './user-context';
import { loadGlobalPermissions } from './utilities/global-permissions';

// What the signed-in user may do on every object, as the server's own answers
// say. Nothing is known until those answers are in: while they are pending,
// after one failed and while nobody is signed in, every check is false, so
// nothing is offered on a guess. The one exception is the same user signing in
// again: what was read for them stays in place while it is read once more, so
// the screens they are using are not torn down. This is presentation only;
// Pulp decides every request.
export type PermissionsState =
  // failed: the last read did not complete, with the reason in error; it is
  // read again on request.
  | { state: 'unknown'; failed: boolean; error?: unknown }
  | { state: 'ready'; isStaff: boolean; global: ReadonlySet<string> };

export type IPermissionsContextType = PermissionsState & {
  // True when the user holds the permission on every object of its kind.
  hasPermission: (name: string) => boolean;
  // Reads again, but only after a failed read. Meant for a route change.
  retryIfFailed: () => void;
  // Reads again on the user's request.
  retry: () => void;
};

const NOTHING_KNOWN: IPermissionsContextType = {
  state: 'unknown',
  failed: false,
  hasPermission: () => false,
  retryIfFailed: () => undefined,
  retry: () => undefined,
};

const PermissionsContext =
  createContext<IPermissionsContextType>(NOTHING_KNOWN);

export const usePermissions = () => useContext(PermissionsContext);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, status, epoch } = useUserContext();
  const queryClient = useQueryClient();
  const [permissions, setPermissions] = useState<PermissionsState>({
    state: 'unknown',
    failed: false,
  });

  // Identifies the latest read, so the answer to an earlier one, or one that
  // arrives after the provider is gone, is ignored.
  const latest = useRef(0);
  // The latest state and the user it was read for, for the retry, which must
  // not depend on a render.
  const current = useRef(permissions);
  current.current = permissions;
  const reading = useRef(user);
  reading.current = user;
  // Who the permissions are read for. Another session never inherits what was
  // read for the one before it.
  const session = user ? (user.pulp_href ?? user.username) : null;

  // The session the current ready state was read for, or null while nothing is
  // ready. A read for that same session keeps the state in place until the
  // answer arrives; any other read starts from nothing known.
  const readyFor = useRef<string | null>(null);

  const read = useCallback(
    (keep: boolean) => {
      const mine = ++latest.current;
      const who = reading.current;
      if (!keep) {
        readyFor.current = null;
        setPermissions({ state: 'unknown', failed: false });
      }

      if (!who) {
        return;
      }

      // The own record is read through the query cache, under the entry of that
      // user's detail: a screen that shows the same record at the same time
      // shares the one request, and a read asked for again reads fresh.
      const readRecord = () => {
        const href = userHref(userUrlId(who.pulp_href));
        if (!href) {
          throw new Error(
            'The signed-in user has no address to read roles from.',
          );
        }
        return queryClient.fetchQuery({
          queryKey: userKeys.detail(href),
          queryFn: ({ signal }) => UserClient.retrieve(href, { signal }),
          staleTime: 0,
        });
      };

      loadGlobalPermissions(who, readRecord).then(
        ({ isStaff, global }) => {
          if (mine === latest.current) {
            readyFor.current = who.pulp_href ?? who.username;
            setPermissions({ state: 'ready', isStaff, global });
          }
        },
        (error) => {
          if (mine === latest.current) {
            readyFor.current = null;
            setPermissions({ state: 'unknown', failed: true, error });
          }
        },
      );
    },
    [queryClient],
  );

  useEffect(() => {
    // Until the session check has answered nothing is known and nothing is
    // asked.
    if (status === 'checking') {
      return;
    }

    read(session !== null && readyFor.current === session);
    return () => {
      latest.current++;
    };
  }, [epoch, read, session, status]);

  const retryIfFailed = useCallback(() => {
    const now = current.current;
    if (now.state === 'unknown' && now.failed && reading.current) {
      read(false);
    }
  }, [read]);

  const retry = useCallback(() => {
    if (reading.current) {
      read(false);
    }
  }, [read]);

  const value = useMemo<IPermissionsContextType>(
    () => ({
      ...permissions,
      hasPermission: (name: string) =>
        permissions.state === 'ready' &&
        (permissions.isStaff || permissions.global.has(name)),
      retryIfFailed,
      retry,
    }),
    [permissions, retryIfFailed, retry],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
};
