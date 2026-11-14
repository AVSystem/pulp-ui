import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
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
