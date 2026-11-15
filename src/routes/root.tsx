import { Outlet, useNavigation } from 'react-router';
import { AppContextProvider } from 'src/app-context';
import { LoadingSpinner, UIVersion } from 'src/components';
import { PermissionsProvider } from 'src/permissions';
import { PluginsProvider } from 'src/plugins';
import { ReauthDialog } from 'src/session/reauth-dialog';
import { Shell } from 'src/shell/shell';
import { UserContextProvider } from 'src/user-context';

export default function Root() {
  const navigation = useNavigation();
  const isNavigating = Boolean(navigation.location);

  return (
    <UserContextProvider>
      <PermissionsProvider>
        <AppContextProvider>
          <PluginsProvider>
            <Shell>
              {isNavigating && <LoadingSpinner />}
              <Outlet />
            </Shell>
            <ReauthDialog />
            <UIVersion />
          </PluginsProvider>
        </AppContextProvider>
      </PermissionsProvider>
    </UserContextProvider>
  );
}
