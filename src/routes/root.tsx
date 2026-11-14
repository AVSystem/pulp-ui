import { Outlet, useNavigation } from 'react-router';
import { AppContextProvider } from 'src/app-context';
import { LoadingSpinner, UIVersion } from 'src/components';
import { PluginsProvider } from 'src/plugins';
import { Shell } from 'src/shell/shell';
import { UserContextProvider } from 'src/user-context';

export default function Root() {
  const navigation = useNavigation();
  const isNavigating = Boolean(navigation.location);

  return (
    <UserContextProvider>
      <AppContextProvider>
        <PluginsProvider>
          <Shell>
            {isNavigating && <LoadingSpinner />}
            <Outlet />
          </Shell>
          <UIVersion />
        </PluginsProvider>
      </AppContextProvider>
    </UserContextProvider>
  );
}
