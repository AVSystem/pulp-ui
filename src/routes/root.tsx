import { Outlet, useNavigation } from 'react-router';
import { AppContextProvider } from 'src/app-context';
import { LoadingSpinner, UIVersion } from 'src/components';
import { Layout } from 'src/layout';
import { PluginsProvider } from 'src/plugins';
import { UserContextProvider } from 'src/user-context';

export default function Root() {
  const navigation = useNavigation();
  const isNavigating = Boolean(navigation.location);

  return (
    <UserContextProvider>
      <AppContextProvider>
        <PluginsProvider>
          <Layout>
            {isNavigating && <LoadingSpinner />}
            <Outlet />
          </Layout>
          <UIVersion />
        </PluginsProvider>
      </AppContextProvider>
    </UserContextProvider>
  );
}
