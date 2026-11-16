import { type ReactNode, createContext, useContext, useState } from 'react';
import { type AlertType } from 'src/components';
import { usePermissions } from './permissions';
import { useUserContext } from './user-context';

export interface IAppContextType {
  alerts: AlertType[];
  hasPermission: (name: string) => boolean;
  // true only when the permissions are known and the signed-in account's own
  // record is staff; Pulp allows some administration actions to staff only
  isStaff: boolean;
  // whether the permissions of the signed-in user are known; until then every
  // permission check answers false
  permissionsReady: boolean;
  queueAlert: (alert: AlertType) => void;
  setAlerts: (alerts: AlertType[]) => void;
  user; // deprecated
}

export const AppContext = createContext<IAppContextType>(undefined);
export const useAppContext = () => useContext(AppContext);

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const { user } = useUserContext();
  const permissions = usePermissions();
  const { hasPermission } = permissions;

  // An alert with an id replaces an open one with the same id, so a refusal
  // repeated while its alert is still shown stays one alert.
  const queueAlert = (alert: AlertType) =>
    setAlerts((alerts) => [
      ...(alert.id ? alerts.filter(({ id }) => id !== alert.id) : alerts),
      alert,
    ]);

  return (
    <AppContext.Provider
      value={{
        alerts,
        hasPermission,
        isStaff: permissions.state === 'ready' && permissions.isStaff,
        permissionsReady: permissions.state === 'ready',
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
