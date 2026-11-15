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
import { useUserContext } from './user-context';
import { loadGlobalPermissions } from './utilities/global-permissions';

// What the signed-in user may do on every object, as the server's own answers
// say. Nothing is known until those answers are in: while they are pending,
// after one failed and while nobody is signed in, every check is false, so
// nothing is offered on a guess. This is presentation only; Pulp decides every
// request.
export type PermissionsState =
  // failed: the last read did not complete; it is read again on request.
  | { state: 'unknown'; failed: boolean }
  | { state: 'ready'; isStaff: boolean; global: ReadonlySet<string> };

export type IPermissionsContextType = PermissionsState & {
  // True when the user holds the permission on every object of its kind.
  hasPermission: (name: string) => boolean;
  // Reads again, but only after a failed read. Meant for a route change.
  retryIfFailed: () => void;
};

const NOTHING_KNOWN: IPermissionsContextType = {
  state: 'unknown',
  failed: false,
  hasPermission: () => false,
  retryIfFailed: () => undefined,
};

const PermissionsContext =
  createContext<IPermissionsContextType>(NOTHING_KNOWN);

export const usePermissions = () => useContext(PermissionsContext);

export const PermissionsProvider = ({ children }: { children: ReactNode }) => {
  const { user, status, epoch } = useUserContext();
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

  const read = useCallback(() => {
    const mine = ++latest.current;
    const who = reading.current;
    setPermissions({ state: 'unknown', failed: false });

    if (!who) {
      return;
    }

    loadGlobalPermissions(who).then(
      ({ isStaff, global }) => {
        if (mine === latest.current) {
          setPermissions({ state: 'ready', isStaff, global });
        }
      },
      () => {
        if (mine === latest.current) {
          setPermissions({ state: 'unknown', failed: true });
        }
      },
    );
  }, []);

  useEffect(() => {
    // Until the session check has answered nothing is known and nothing is
    // asked.
    if (status === 'checking') {
      return;
    }

    read();
    return () => {
      latest.current++;
    };
  }, [epoch, read, session, status]);

  const retryIfFailed = useCallback(() => {
    const now = current.current;
    if (now.state === 'unknown' && now.failed && reading.current) {
      read();
    }
  }, [read]);

  const value = useMemo<IPermissionsContextType>(
    () => ({
      ...permissions,
      hasPermission: (name: string) =>
        permissions.state === 'ready' &&
        (permissions.isStaff || permissions.global.has(name)),
      retryIfFailed,
    }),
    [permissions, retryIfFailed],
  );

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
};
