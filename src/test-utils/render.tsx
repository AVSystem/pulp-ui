import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { QueryClient } from '@tanstack/react-query';
import { type RenderOptions, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { PermissionsProvider } from 'src/permissions';
import { PluginsProvider } from 'src/plugins';
import { SessionQueryBridge } from 'src/query/session-bridge';
import { setSignedIn } from 'src/session/session-events';
import { UserContextProvider } from 'src/user-context';
import { QueryWrapper, createTestQueryClient } from './query';

interface IRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  // The location the router starts at, including any query string.
  route?: string;
  // Counts the user as signed in from the first request on, as in the
  // application, where a screen is shown only after the session check has
  // answered. Without it the screen's own first read races the session check
  // in the provider, and its refusal is that of a visitor.
  signedIn?: boolean;
  // The query client of the render. Without one, every render gets a fresh
  // client, so no test reads what another test cached.
  queryClient?: QueryClient;
}

// Renders the element inside the providers the application supplies: query
// client, message catalog, session context and a router that starts at the
// given route. The result carries a user-event instance bound to the same
// document and the query client the screen runs on.
export function renderWithProviders(
  ui: ReactElement,
  {
    route = '/',
    signedIn = false,
    queryClient = createTestQueryClient(),
    ...options
  }: IRenderOptions = {},
) {
  const user = userEvent.setup();

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryWrapper client={queryClient}>
      <I18nProvider i18n={i18n}>
        <UserContextProvider>
          <SessionQueryBridge />
          <PermissionsProvider>
            <PluginsProvider>
              <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
            </PluginsProvider>
          </PermissionsProvider>
        </UserContextProvider>
      </I18nProvider>
    </QueryWrapper>
  );

  const rendered = render(ui, { wrapper: Wrapper, ...options });
  // The provider's own effect has just recorded that nobody is signed in.
  if (signedIn) {
    setSignedIn(true);
  }

  return { user, queryClient, ...rendered };
}
