import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRoutes } from 'src/app-routes';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { listOf } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import { Shell } from './shell';

function signIn() {
  server.use(
    http.get('*/pulp/api/v3/login/', () =>
      HttpResponse.json({
        username: 'zoe',
        pulp_href: '/pulp/api/v3/users/1/',
      }),
    ),
  );
}

function renderShell(route = '/status') {
  return renderWithProviders(
    <Shell>
      <h1>Screen title</h1>
    </Shell>,
    { route },
  );
}

describe('app shell', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    // wide enough for the persistent sidebar
    setPageWidth(1400);
  });

  afterEach(resetPageWidth);

  it('has a banner, a navigation named Main and the main container', async () => {
    renderShell();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeVisible();

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(main).toContainElement(
      screen.getByRole('heading', { name: 'Screen title' }),
    );
  });

  it('makes the skip link the first stop of the tab order, leading to the main container', async () => {
    const { user } = renderShell();

    await user.tab();

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveFocus();
    expect(skip).toHaveAttribute('href', '#main-content');
  });

  it('makes the scrolling main container reachable by keyboard without changing the first tab stop', async () => {
    const { user } = renderShell();

    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('tabindex', '0');

    await user.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
    expect(main).not.toHaveFocus();
  });

  it('shows the logo, the wordmark and the host of the running origin as one link to Status', async () => {
    renderShell('/tasks');

    const brand = screen.getByRole('link', { name: 'Pulp, pulp.example.com' });
    expect(brand).toHaveAttribute('href', '/status/');
    expect(brand).toHaveTextContent('Pulp');
    expect(brand).toHaveTextContent('pulp.example.com');
  });

  it('follows the host the page is served from, never a fixed name', async () => {
    setPageUrl('https://registry.example.org:8443/ui/');

    renderShell();

    expect(
      screen.getByRole('link', { name: 'Pulp, registry.example.org:8443' }),
    ).toBeInTheDocument();
  });

  it('offers the account menu when signed in and the sign-in link when not', async () => {
    const signedOut = renderShell();
    expect(
      await within(screen.getByRole('banner')).findByRole('link', {
        name: 'Login',
      }),
    ).toBeVisible();
    expect(document.querySelector('[data-cy=user-dropdown]')).toBeNull();
    signedOut.unmount();

    signIn();
    renderShell();
    await waitFor(() =>
      expect(document.querySelector('[data-cy=user-dropdown]')).not.toBeNull(),
    );
  });

  it('tells the user when the sign-out did not complete and keeps them signed in', async () => {
    signIn();
    server.use(
      http.delete('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ detail: 'Refused.' }, { status: 403 }),
      ),
    );
    const { user } = renderShell();

    const toggle = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        'button[data-cy=user-dropdown]',
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    await user.click(toggle);
    await user.click(
      await screen.findByRole('menuitem', { name: /^logout$/i }),
    );

    expect(
      await screen.findByText('Sign-out did not complete'),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-cy=user-dropdown]')).not.toBeNull();
  });
});

// The shell around the guarded routes of the application, as the application
// renders them.
const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

function Routed() {
  const { pathname } = useLocation();
  return (
    <>
      <p data-testid='location'>{pathname}</p>
      {useRoutes(guardedRoutes)}
    </>
  );
}

describe('logout', () => {
  const logout = async (user: ReturnType<typeof renderShellRouted>['user']) => {
    const toggle = await waitFor(() => {
      const element = document.querySelector<HTMLElement>(
        'button[data-cy=user-dropdown]',
      );
      expect(element).not.toBeNull();
      return element as HTMLElement;
    });
    await user.click(toggle);
    await user.click(
      await screen.findByRole('menuitem', { name: /^logout$/i }),
    );
  };

  function renderShellRouted() {
    return renderWithProviders(
      <Shell>
        <Routed />
      </Shell>,
      { route: '/signature-keys' },
    );
  }

  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1400);
    signIn();
    server.use(
      listOf('/pulp/api/v3/signing-services/', []).handler,
      http.get('*/pulp/api/v3/users/1/', () =>
        HttpResponse.json({ id: 1, is_staff: true, groups: [] }),
      ),
    );
  });

  afterEach(() => {
    resetPageWidth();
    config.UI_EXTERNAL_LOGIN_URI = null;
    vi.restoreAllMocks();
  });

  describe('with an external login address', () => {
    beforeEach(() => {
      config.UI_EXTERNAL_LOGIN_URI = 'https://login.example/start';
    });

    it('ends the Pulp session and lands on the signed out page without a redirect', async () => {
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);
      const deletes: string[] = [];
      server.use(
        http.delete('*/pulp/api/v3/login/', ({ request }) => {
          deletes.push(new URL(request.url).pathname);
          return new HttpResponse(null, { status: 204 });
        }),
      );
      const { user } = renderShellRouted();
      await screen.findByRole('heading', { name: 'Signature keys' });

      await logout(user);

      expect(
        await screen.findByText('You have been signed out of Pulp.'),
      ).toBeVisible();
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/signed-out\/?$/,
      );
      expect(deletes).toEqual(['/pulp/api/v3/login/']);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(replace).not.toHaveBeenCalled();
      expect(screen.queryByText('Sign-in did not complete')).toBeNull();
    });

    it('keeps the user signed in on the current screen when the logout fails', async () => {
      const replace = vi
        .spyOn(window.location, 'replace')
        .mockImplementation(() => undefined);
      server.use(
        http.delete('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ detail: 'Broken.' }, { status: 500 }),
        ),
      );
      const { user } = renderShellRouted();
      await screen.findByRole('heading', { name: 'Signature keys' });

      await logout(user);

      expect(
        await screen.findByText('Sign-out did not complete'),
      ).toBeInTheDocument();
      expect(screen.getByText(/You are still signed in\./)).toBeInTheDocument();
      expect(screen.getByTestId('location')).toHaveTextContent(
        /^\/signature-keys$/,
      );
      expect(
        screen.getByRole('heading', { name: 'Signature keys' }),
      ).toBeVisible();
      expect(replace).not.toHaveBeenCalled();
    });
  });

  it('without an external login address goes to the sign-in page as before', async () => {
    server.use(
      http.delete(
        '*/pulp/api/v3/login/',
        () => new HttpResponse(null, { status: 204 }),
      ),
    );
    const { user } = renderShellRouted();
    await screen.findByRole('heading', { name: 'Signature keys' });

    await logout(user);

    expect(await screen.findByLabelText(/username/i)).toBeVisible();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/login\/?$/);
  });
});

const sidebar = () => document.getElementById('page-sidebar') as HTMLElement;
const isClosed = () => sidebar().getAttribute('aria-hidden') === 'true';

describe('sidebar drawer below 1200px', () => {
  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
    setPageWidth(1000);
  });

  afterEach(resetPageWidth);

  it('starts closed and opens from the top bar toggle', async () => {
    const { user } = renderShell('/tasks');

    expect(isClosed()).toBe(true);
    expect(document.querySelector('.pulp-drawer-backdrop')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    expect(isClosed()).toBe(false);
    expect(document.querySelector('.pulp-drawer-backdrop')).not.toBeNull();
  });

  it('closes on a route change and returns focus to the toggle', async () => {
    const { user } = renderShell('/tasks');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    await user.click(within(sidebar()).getByRole('link', { name: 'Login' }));

    await waitFor(() => expect(isClosed()).toBe(true));
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveFocus();
  });

  it('closes on Escape and returns focus to the toggle', async () => {
    const { user } = renderShell('/tasks');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));
    // focus is somewhere else on the page, as after a click on the sidebar
    (document.activeElement as HTMLElement).blur();

    await user.keyboard('{Escape}');

    expect(isClosed()).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveFocus();
  });

  it('closes on a click on the backdrop and returns focus to the toggle', async () => {
    const { user } = renderShell('/tasks');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    await user.click(
      document.querySelector('.pulp-drawer-backdrop') as HTMLElement,
    );

    expect(isClosed()).toBe(true);
    expect(document.querySelector('.pulp-drawer-backdrop')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).toHaveFocus();
  });

  it('leaves the drawer open when Escape closes the search dialog', async () => {
    const { user } = renderShell('/tasks');
    await user.click(screen.getByRole('button', { name: 'Open navigation' }));

    await user.click(
      within(sidebar()).getByRole('button', { name: /Search or go to/ }),
    );
    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Search or go to' }),
      ).toBeNull(),
    );
    expect(isClosed()).toBe(false);
  });

  it('does nothing on Escape while the drawer is closed', async () => {
    const { user } = renderShell('/tasks');

    await user.keyboard('{Escape}');

    expect(isClosed()).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Open navigation' }),
    ).not.toHaveFocus();
  });

  it('has no backdrop and no toggle on a wide screen with the sidebar open', async () => {
    setPageWidth(1440);

    renderShell('/tasks');

    expect(isClosed()).toBe(false);
    expect(document.querySelector('.pulp-drawer-backdrop')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Open navigation' }),
    ).not.toBeInTheDocument();
  });
});

describe('top bar at phone width', () => {
  const matchMedia = window.matchMedia;

  beforeEach(() => {
    setPageUrl('https://pulp.example.com/ui/');
  });

  afterEach(() => {
    resetPageWidth();
    window.matchMedia = matchMedia;
  });

  const waitForAccount = () =>
    waitFor(() => {
      const toggle = document.querySelector<HTMLElement>(
        'button[data-cy=user-dropdown]',
      );
      expect(toggle).not.toBeNull();
      return toggle as HTMLElement;
    });

  it('moves Help and Language into the account menu at 390px', async () => {
    setPageWidth(390);
    signIn();
    const { user } = renderShell('/tasks');

    const toggle = await waitForAccount();
    expect(document.querySelector('[data-cy=docs-dropdown]')).toBeNull();
    expect(document.querySelector('[data-cy=language-dropdown]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Theme' })).toBeVisible();

    await user.click(toggle);

    expect(screen.getByRole('heading', { name: 'Help' })).toBeVisible();
    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent ?? '');
    expect(items).toEqual(
      expect.arrayContaining([
        'Documentation',
        'About Pulp UI',
        'About project',
        'Reset to browser defaults',
      ]),
    );
  });

  it('keeps the separate Help button at 1440px', async () => {
    setPageWidth(1440);
    signIn();
    renderShell('/tasks');

    await waitForAccount();

    expect(document.querySelector('[data-cy=docs-dropdown]')).not.toBeNull();
    expect(
      document.querySelector('[data-cy=language-dropdown]'),
    ).not.toBeNull();
  });

  it('keeps Help and Language reachable in the top bar for a visitor who is not signed in', async () => {
    setPageWidth(390);

    renderShell('/status');

    expect(
      await within(screen.getByRole('banner')).findByRole('link', {
        name: 'Login',
      }),
    ).toBeVisible();
    expect(document.querySelector('[data-cy=docs-dropdown]')).not.toBeNull();
  });
});
