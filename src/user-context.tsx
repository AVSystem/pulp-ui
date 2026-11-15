import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { PulpLoginAPI } from './api/pulp-login';
import { Paths, formatPath } from './paths';
import { resume, setSignedIn } from './session/session-events';
import { forgetExternalLogin } from './utilities/external-login-attempt';
import { removeStored } from './utilities/safe-storage';
import { uiPath } from './utilities/ui-path';

export interface ISessionUser {
  username: string;
  pulp_href?: string;
}

// 'unknown' is a first check that got no usable answer: only a 401 means
// signed out and only a 2xx means signed in.
type SessionStatus = 'checking' | 'anonymous' | 'authenticated' | 'unknown';

interface IUserContextType {
  user: ISessionUser | null;
  status: SessionStatus;
  // Why the first check got no usable answer, while the status is 'unknown'.
  sessionError: unknown;
  // Asks the server again who is signed in, after an unknown answer.
  retrySessionCheck: () => void;
  setUser: (user: ISessionUser | null) => void;
  logout: () => Promise<void>;
  // Clears the user without a request, for when the server already ended the
  // session. The optional reason travels to the login page through the guard.
  endSession: (reason?: string) => void;
  endReason: string | null;
  // Grows each time the same user signs in again after the session ended, so
  // a screen can read its data again.
  epoch: number;
  // Signs in through the dialog shown over the current screen. Resolves
  // 'same' when the same user came back and 'other' when another user signed
  // in, in which case the page is loaded afresh.
  signInAgain: (
    username: string,
    password: string,
  ) => Promise<'same' | 'other'>;
}

const UserContext = createContext<IUserContextType>(undefined);
export const useUserContext = () => useContext(UserContext);

// Tells two sessions apart: the user's address, or the name when the answer
// carries none.
const sessionKey = (user: ISessionUser | null) =>
  user ? (user.pulp_href ?? user.username) : null;

function logoutFailure(error): Error {
  const response = error?.response;
  const detail = response?.data?.detail;
  return new Error(
    (typeof detail === 'string' && detail) ||
      response?.statusText ||
      error?.message ||
      String(error),
  );
}

export const UserContextProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUserState] = useState<ISessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>('checking');
  const [endReason, setEndReason] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [sessionError, setSessionError] = useState<unknown>(null);

  const setUser = (next: ISessionUser | null) => {
    setUserState(next);
    setStatus(next ? 'authenticated' : 'anonymous');
    setEndReason(null);
  };

  // The API layer only treats a 401 as an ended session while a user is
  // signed in.
  useEffect(() => {
    setSignedIn(Boolean(user));
  }, [user]);
  useEffect(() => () => setSignedIn(false), []);

  // Who is signed in, asked of the server. Only a 401 means nobody is: any
  // other failure says nothing about the session and must never be taken for
  // a logout.
  const checkSession = useCallback(() => {
    PulpLoginAPI.whoami().then(
      ({ data }) => {
        // A session the server recognises ends any pending external login
        // attempt.
        forgetExternalLogin();
        setSessionError(null);
        setUser({ username: data.username, pulp_href: data.pulp_href });
      },
      (error) => {
        if (error?.response?.status === 401) {
          setSessionError(null);
          setUser(null);
          return;
        }
        setSessionError(error);
        setStatus('unknown');
      },
    );
  }, []);

  const retrySessionCheck = () => {
    setStatus('checking');
    checkSession();
  };

  useEffect(() => {
    // An older version of this UI kept the password in browser storage in plain
    // text. The keys are deleted without being read or used, so nothing left
    // behind can sign anyone in or leak.
    removeStored('credentials');
    removeStored('credentials', 'sessionStorage');

    checkSession();
  }, [checkSession]);

  const signInAgain = async (username: string, password: string) => {
    const { data } = await PulpLoginAPI.login(username, password);
    const next = { username: data.username, pulp_href: data.pulp_href };

    if (sessionKey(next) !== sessionKey(user)) {
      // Everything in memory belongs to the previous user. A full page load
      // drops all of it (forms, permissions, caches) in one step, which no
      // piece of code could do reliably one state at a time.
      window.location.assign(uiPath(formatPath(Paths.core.status)));
      return 'other' as const;
    }

    // The same user comes back to the same screen; the screen reads again.
    setUser(next);
    setEpoch((previous) => previous + 1);
    resume();
    return 'same' as const;
  };

  const endSession = (reason?: string) => {
    setUser(null);
    setEndReason(reason ?? null);
  };

  const logout = () =>
    PulpLoginAPI.logout().then(
      () => endSession(),
      (error) => {
        // 401 means the server session is already gone, which is the state a
        // logout aims for. Any other failure (for example a CSRF refusal or a
        // dropped connection) leaves the session alive, so the user must not
        // be shown as signed out.
        if (error?.response?.status === 401) {
          endSession();
          return;
        }
        throw logoutFailure(error);
      },
    );

  return (
    <UserContext.Provider
      value={{
        user,
        status,
        sessionError,
        retrySessionCheck,
        setUser,
        logout,
        endSession,
        endReason,
        epoch,
        signInAgain,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

// The number of times the same user signed in again; 0 outside the provider.
export const useSessionEpoch = () => useContext(UserContext)?.epoch ?? 0;
