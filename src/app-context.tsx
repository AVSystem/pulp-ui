import { type ReactNode, createContext, useContext, useState } from 'react';
import { type AlertType } from 'src/components';
import { useUserContext } from './user-context';

export interface IAppContextType {
  alerts: AlertType[];
  hasPermission: (name: string) => boolean;
  queueAlert: (alert: AlertType) => void;
  setAlerts: (alerts: AlertType[]) => void;
  user; // deprecated
}

export const AppContext = createContext<IAppContextType>(undefined);
export const useAppContext = () => useContext(AppContext);

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const { user } = useUserContext();

  const queueAlert = (alert) => setAlerts((alerts) => [...alerts, alert]);
  const hasPermission = (_name) => true; // FIXME: permission handling

  return (
    <AppContext.Provider
      value={{
        alerts,
        hasPermission,
        queueAlert,
        setAlerts,
        // FIXME: hack
        user: user
          ? {
              username: user.username,
              groups: [],
              model_permissions: {},
            }
          : null,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
