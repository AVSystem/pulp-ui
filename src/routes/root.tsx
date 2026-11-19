import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Outlet, useLocation, useNavigation } from 'react-router';
import { AppContextProvider } from 'src/app-context';
import { LoadingSpinner, UIVersion } from 'src/components';
import { PermissionsProvider } from 'src/permissions';
import { PluginsProvider } from 'src/plugins';
import { createQueryClient } from 'src/query/client';
import { SessionQueryBridge } from 'src/query/session-bridge';
import { ReauthDialog } from 'src/session/reauth-dialog';
import { isSignedOutPath } from 'src/session/session-events';
import { Shell } from 'src/shell/shell';
import { UserContextProvider } from 'src/user-context';

export default function Root() {
  // One cache for the page load; the bridge empties it when the account changes.
  const [queryClient] = useState(createQueryClient);
  const navigation = useNavigation();
  const isNavigating = Boolean(navigation.location);
  // The signed out page asks nothing of the server and stands on its own,
  // like the sign-in frame: no masthead, sidebar or notification panel.
  const bare = isSignedOutPath(useLocation().pathname);

  return (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <SessionQueryBridge />
        <PermissionsProvider>
          <AppContextProvider>
            <PluginsProvider>
              {bare ? (
                <Outlet />
              ) : (
                <Shell>
                  {isNavigating && <LoadingSpinner />}
                  <Outlet />
                </Shell>
              )}
              <ReauthDialog />
              <UIVersion />
            </PluginsProvider>
          </AppContextProvider>
        </PermissionsProvider>
      </UserContextProvider>
    </QueryClientProvider>
  );
}
