import { type ReactNode, createContext, useContext, useState } from 'react';
import { type AlertType } from 'src/components';
import { usePermissions } from './permissions';

export interface IAppContextType {
  alerts: AlertType[];
  hasPermission: (name: string) => boolean;
  // true only when the permissions are known and the signed-in account's own
  // record is staff; Pulp allows some administration actions to staff only
  isStaff: boolean;
  // the last read of the permissions failed; the reason is in permissionsError.
  // Only a screen that shows this state itself uses it: every permission check
  // answers false until a read has answered
  permissionsFailed: boolean;
  permissionsError: unknown;
  // whether the permissions of the signed-in user are known; until then every
  // permission check answers false
  permissionsReady: boolean;
  queueAlert: (alert: AlertType) => void;
  // reads the permissions again, on the user's request
  retryPermissions: () => void;
  setAlerts: (alerts: AlertType[]) => void;
}

export const AppContext = createContext<IAppContextType>(undefined);
export const useAppContext = () => useContext(AppContext);

export const AppContextProvider = ({ children }: { children: ReactNode }) => {
  const [alerts, setAlerts] = useState<AlertType[]>([]);
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
        permissionsFailed:
          permissions.state === 'unknown' && permissions.failed,
        permissionsError:
          permissions.state === 'unknown' ? permissions.error : undefined,
        permissionsReady: permissions.state === 'ready',
        queueAlert,
        retryPermissions: permissions.retry,
        setAlerts,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};
