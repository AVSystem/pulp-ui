import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { PulpLoginAPI } from './api/pulp-login';
import { Paths, formatPath } from './paths';
import { isSuspended, resume, setSignedIn } from './session/session-events';
import { config } from './ui-config';
import { forgetExternalLogin } from './utilities/external-login-attempt';
import { removeStored } from './utilities/safe-storage';
import { uiPath } from './utilities/ui-path';

export interface ISessionUser {
  username: string;
  pulp_href?: string;
}

// The state of the session when a question about it was asked; see
// `sessionMark` and `isCurrentSession` of the context.
export interface ISessionMark {
  key: string | null;
  generation: number;
  epoch: number;
  ended: boolean;
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
  // Grows each time the signed-in account goes away or changes (a sign-out, an
  // end of the session by the server, another account taking its place). A
  // session that merely ended keeps the account and the generation. A screen
  // mounted for one signed-in account must not outlive that account.
  generation: number;
  // What a question about the session is asked for: the account in memory, the
  // generation, the epoch and whether the session had ended at that moment.
  sessionMark: () => ISessionMark;
  // Whether the session in memory is still the one the mark was taken for. The
  // generation grows whenever the account in memory goes away or changes, so
  // an unchanged generation means the same account stayed in memory without a
  // break (comparing keys alone would miss a sign-out followed by the same
  // account signing in again). The epoch grows on every restore, so an
  // unchanged epoch means no restore happened in between. Both functions read
  // only values kept in step with the state, so a copy held by a listener
  // answers about the session really in memory.
  isCurrentSession: (mark: ISessionMark) => boolean;
  // Signs in through the dialog shown over the current screen. Resolves
  // 'same' when the same user came back and 'other' when another user signed
  // in, in which case the page is loaded afresh.
  signInAgain: (
    username: string,
    password: string,
  ) => Promise<'same' | 'other'>;
  // Continues as the account in memory after its session ended and came back
  // elsewhere. Acts only while the session is ended and only for that account;
  // returns whether it acted, so callers that race each other restore once.
  restoreSession: (next: ISessionUser) => boolean;
}

const UserContext = createContext<IUserContextType>(undefined);
export const useUserContext = () => useContext(UserContext);

// Tells two sessions apart: the user's address, or the name when the answer
// carries none.
export const sessionKey = (user: ISessionUser | null) =>
  user ? (user.pulp_href ?? user.username) : null;

// The address of the signed out page, below the base path the UI is served
// under, compared with the address of the running page.
function onSignedOutPage() {
  const trim = (path?: string) => String(path ?? '').replace(/\/+$/, '');
  return trim(window.location.pathname) === trim(uiPath(Paths.meta.signedOut));
}

// The reason an ended session carries when the user logged out of an
// installation with an external login: the guard then sends them to the signed
// out page instead of to the external login, which would sign them straight
// back in.
export const SIGNED_OUT_REASON = 'signed-out';

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
  const [generation, setGeneration] = useState(0);
  const [sessionError, setSessionError] = useState<unknown>(null);
  // The session key of the account in memory, kept in step with the state so
  // that every caller of setUser, including ones holding an older copy of it,
  // is compared against the account that is really signed in.
  const signedInKey = useRef<string | null>(null);
  // The generation and the epoch, kept in step with their state in the same
  // statements, so a callback that runs when a request is answered reads the
  // values really in memory even before React has rendered them.
  const generationRef = useRef(0);
  const epochRef = useRef(0);

  const setUser = (next: ISessionUser | null) => {
    const nextKey = sessionKey(next);
    // The generation grows in the same update as the user, so no render shows
    // the screen of the old account with the new identity. Nobody signed in
    // before (the first check, the first sign-in) and the same account coming
    // back (the epoch covers that) leave it alone.
    if (signedInKey.current !== null && signedInKey.current !== nextKey) {
      generationRef.current += 1;
      setGeneration(generationRef.current);
    }
    signedInKey.current = nextKey;
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

    // The signed out page asks nothing: the session is over, and a request
    // here could only start a sign-in again.
    if (onSignedOutPage()) {
      setUser(null);
      return;
    }

    checkSession();
  }, [checkSession]);

  // One restore per ended session, so screens read once however many answers
  // (the dialog's sign-in, a check on returning to the tab) arrive for it. The
  // account is compared with the one in memory at call time, never with a copy
  // a listener captured earlier.
  const restoreSession = (next: ISessionUser) => {
    if (!isSuspended() || sessionKey(next) !== signedInKey.current) {
      return false;
    }
    setUser(next);
    epochRef.current += 1;
    setEpoch(epochRef.current);
    resume();
    return true;
  };

  const sessionMark = (): ISessionMark => ({
    key: signedInKey.current,
    generation: generationRef.current,
    epoch: epochRef.current,
    ended: isSuspended(),
  });

  const isCurrentSession = (mark: ISessionMark) =>
    mark.generation === generationRef.current &&
    mark.epoch === epochRef.current;

  const signInAgain = async (username: string, password: string) => {
    const { data } = await PulpLoginAPI.login(username, password);
    const next = { username: data.username, pulp_href: data.pulp_href };

    if (sessionKey(next) !== signedInKey.current) {
      // Everything in memory belongs to the previous user. A full page load
      // drops all of it (forms, permissions, caches) in one step, which no
      // piece of code could do reliably one state at a time.
      window.location.assign(uiPath(formatPath(Paths.core.status)));
      return 'other' as const;
    }

    // The same user comes back to the same screen; the screen reads again.
    restoreSession(next);
    return 'same' as const;
  };

  const endSession = (reason?: string) => {
    setUser(null);
    setEndReason(reason ?? null);
  };

  const endByLogout = () =>
    endSession(config.UI_EXTERNAL_LOGIN_URI ? SIGNED_OUT_REASON : undefined);

  const logout = () =>
    PulpLoginAPI.logout().then(
      () => endByLogout(),
      (error) => {
        // 401 means the server session is already gone, which is the state a
        // logout aims for. Any other failure (for example a CSRF refusal or a
        // dropped connection) leaves the session alive, so the user must not
        // be shown as signed out.
        if (error?.response?.status === 401) {
          endByLogout();
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
        generation,
        sessionMark,
        isCurrentSession,
        signInAgain,
        restoreSession,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};

// The number of times the same user signed in again; 0 outside the provider.
export const useSessionEpoch = () => useContext(UserContext)?.epoch ?? 0;

// The number of times the signed-in account went away; 0 outside the provider.
export const useSessionGeneration = () =>
  useContext(UserContext)?.generation ?? 0;
