import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { type RenderOptions, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { UserContextProvider } from 'src/user-context';

interface IRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  // The location the router starts at, including any query string.
  route?: string;
}

// Renders the element inside the providers the application supplies: message
// catalog, session context and a router that starts at the given route. The
// result carries a user-event instance bound to the same document.
export function renderWithProviders(
  ui: ReactElement,
  { route = '/', ...options }: IRenderOptions = {},
) {
  const user = userEvent.setup();

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <I18nProvider i18n={i18n}>
      <UserContextProvider>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </UserContextProvider>
    </I18nProvider>
  );

  return { user, ...render(ui, { wrapper: Wrapper, ...options }) };
}
