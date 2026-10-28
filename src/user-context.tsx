import {
  type ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from 'react';
import { PulpLoginAPI } from './api/pulp-login';

export interface ISessionUser {
  username: string;
  pulp_href?: string;
}

type SessionStatus = 'checking' | 'anonymous' | 'authenticated';

interface IUserContextType {
  user: ISessionUser | null;
  status: SessionStatus;
  setUser: (user: ISessionUser | null) => void;
  logout: () => Promise<void>;
  // Clears the user without a request, for when the server already ended the
  // session. The optional reason travels to the login page through the guard.
  endSession: (reason?: string) => void;
  endReason: string | null;
}

const UserContext = createContext<IUserContextType>(undefined);
export const useUserContext = () => useContext(UserContext);

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

  const setUser = (next: ISessionUser | null) => {
    setUserState(next);
    setStatus(next ? 'authenticated' : 'anonymous');
    setEndReason(null);
  };

  useEffect(() => {
    // An older version of this UI kept the password in browser storage in plain
    // text. The keys are deleted without being read or used, so nothing left
    // behind can sign anyone in or leak.
    window.localStorage.removeItem('credentials');
    window.sessionStorage.removeItem('credentials');

    PulpLoginAPI.whoami()
      .then(({ data }) =>
        setUser({ username: data.username, pulp_href: data.pulp_href }),
      )
      .catch(() => setUser(null));
  }, []);

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
        setUser,
        logout,
        endSession,
        endReason,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
