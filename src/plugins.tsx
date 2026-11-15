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
import {
  plugin_versions,
  resetPluginVersionsCache,
} from './utilities/plugin-version';

// What the server reports as installed, read once per signed-in session and
// shared by everything that needs it. A failed answer is its own state: it
// says nothing about which plugins are installed.
export type PluginsState =
  // Signed out: nothing is read and nothing is known about plugins.
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; versions: Map<string, string> }
  | { state: 'error'; error: unknown };

export type IPluginsContextType = PluginsState & {
  // Asks the server again.
  retry: () => void;
};

const PluginsContext = createContext<IPluginsContextType>(undefined);

export const usePlugins = () => useContext(PluginsContext);

export const PluginsProvider = ({ children }: { children: ReactNode }) => {
  const { user, status } = useUserContext();
  const [plugins, setPlugins] = useState<PluginsState>({ state: 'loading' });
  // Identifies the latest load, so an answer to an earlier one, or one that
  // arrives after the provider is gone, is ignored.
  const latest = useRef(0);
  // The session the list was last read for; null once signed out.
  const readFor = useRef<string | null | undefined>(undefined);

  // Who the list is read for. It follows the signed-in user, so another
  // session never inherits what was read for the one before it.
  const session = user ? (user.pulp_href ?? user.username) : null;

  const load = useCallback((fresh = false) => {
    const current = ++latest.current;
    plugin_versions({ fresh }).then(
      (list) => {
        if (current === latest.current) {
          setPlugins({
            state: 'ready',
            versions: new Map(list.map(({ name, version }) => [name, version])),
          });
        }
      },
      (error) => {
        if (current === latest.current) {
          setPlugins({ state: 'error', error });
        }
      },
    );
  }, []);

  useEffect(() => {
    // Until the session check has answered nothing is known: no request, and
    // the state stays as loading.
    if (status === 'checking') {
      return;
    }

    if (readFor.current !== undefined && readFor.current !== session) {
      resetPluginVersionsCache();
    }
    readFor.current = session;

    if (!session) {
      setPlugins({ state: 'idle' });
      return;
    }

    setPlugins({ state: 'loading' });
    load();
    return () => {
      latest.current++;
    };
  }, [load, session, status]);

  const retry = useCallback(() => {
    setPlugins({ state: 'loading' });
    load(true);
  }, [load]);

  const value = useMemo(() => ({ ...plugins, retry }), [plugins, retry]);

  return (
    <PluginsContext.Provider value={value}>{children}</PluginsContext.Provider>
  );
};
