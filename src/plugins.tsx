import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { plugin_versions } from './utilities/plugin-version';

// What the server reports as installed, read once and shared by everything
// that needs it. A failed answer is its own state: it says nothing about
// which plugins are installed.
export type PluginsState =
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
  const [plugins, setPlugins] = useState<PluginsState>({ state: 'loading' });
  // Identifies the latest load, so an answer to an earlier one, or one that
  // arrives after the provider is gone, is ignored.
  const latest = useRef(0);

  const load = useCallback(() => {
    const current = ++latest.current;
    plugin_versions().then(
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
    load();
    return () => {
      latest.current++;
    };
  }, [load]);

  const retry = useCallback(() => {
    setPlugins({ state: 'loading' });
    load();
  }, [load]);

  return (
    <PluginsContext.Provider value={{ ...plugins, retry }}>
      {children}
    </PluginsContext.Provider>
  );
};
