import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render as renderInto, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataRoutes } from 'src/app-routes';
import { resetPageWidth, setPageUrl, setPageWidth } from 'src/test-utils/page';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import SignedOut from './signed-out';

// What a user sees after logging out of an installation that signs in through
// an external login service.

const EXTERNAL = 'https://login.example/start';

beforeEach(() => {
  config.UI_EXTERNAL_LOGIN_URI = EXTERNAL;
  setPageUrl('https://pulp.example.com/ui/signed-out/');
});

afterEach(() => {
  config.UI_EXTERNAL_LOGIN_URI = null;
  vi.restoreAllMocks();
});

const render = () =>
  renderWithProviders(<SignedOut />, { route: '/signed-out' });

describe('the signed out page', () => {
  it('says the user has been signed out of Pulp', async () => {
    render();

    expect(await screen.findByText('Signed out')).toBeVisible();
    expect(screen.getByText('You have been signed out of Pulp.')).toBeVisible();
  });

  it('offers a full-width Sign in again link to the external login with the start page as return path', async () => {
    render();

    const link = await screen.findByRole('link', { name: 'Sign in again' });
    expect(link).toHaveAttribute(
      'href',
      `${EXTERNAL}?next=${encodeURIComponent('/ui/status/')}`,
    );
    expect(link.className).toContain('pf-m-block');
  });

  it('offers no Logout or account control and no other link', async () => {
    render();

    await screen.findByText('Signed out');
    expect(screen.queryByRole('button', { name: /logout/i })).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('sends no request while it is shown', async () => {
    const sent: string[] = [];
    server.events.on('request:start', ({ request }) => {
      sent.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    render();

    await screen.findByText('Signed out');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sent).toEqual([]);
    server.events.removeAllListeners();
  });

  it('does not redirect by itself', async () => {
    const replace = vi
      .spyOn(window.location, 'replace')
      .mockImplementation(() => undefined);
    const assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
    render();

    await screen.findByText('Signed out');
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });
});

// The page is drawn by the route table, outside the application shell.
describe('the signed out page in the route table', () => {
  beforeEach(() => setPageWidth(1400));
  afterEach(() => resetPageWidth());

  const renderRoute = (route: string) =>
    renderInto(
      <I18nProvider i18n={i18n}>
        <RouterProvider
          router={createMemoryRouter(dataRoutes, { initialEntries: [route] })}
        />
      </I18nProvider>,
    );

  // The sign-in frame's own logo header is a banner landmark; the masthead of
  // the application shell is not there.
  const expectNoShell = () => {
    expect(document.querySelector('.pf-v6-c-masthead')).toBeNull();
    for (const banner of screen.queryAllByRole('banner')) {
      expect(banner).toHaveClass('pf-v6-c-login__header');
    }
  };

  it('stands on its own: no masthead, no sidebar navigation and no notification bell', async () => {
    renderRoute('/signed-out');

    expect(await screen.findByText('Signed out')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Sign in again' })).toBeVisible();
    expectNoShell();
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('button', { name: /notification/i })).toBeNull();
  });

  it('is found at its address with a trailing slash too', async () => {
    renderRoute('/signed-out/');

    expect(await screen.findByText('Signed out')).toBeVisible();
    expectNoShell();
  });

  it('sends no request', async () => {
    const sent: string[] = [];
    server.events.on('request:start', ({ request }) => {
      sent.push(`${request.method} ${new URL(request.url).pathname}`);
    });
    renderRoute('/signed-out');

    await screen.findByText('Signed out');
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(sent).toEqual([]);
    server.events.removeAllListeners();
  });

  it('keeps the application shell around every other screen', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({
          username: 'zoe',
          pulp_href: '/pulp/api/v3/users/1/',
        }),
      ),
    );
    renderRoute('/about');

    await waitFor(() =>
      expect(document.querySelector('.pf-v6-c-masthead')).not.toBeNull(),
    );
    expect(
      await screen.findByRole('navigation', { name: 'Main' }),
    ).toBeVisible();
  });
});

describe('the signed out page layout', () => {
  it('separates the body line and the button with a class of its own', async () => {
    render();

    const line = await screen.findByText('You have been signed out of Pulp.');
    expect(line).toHaveClass('pulp-signed-out__text');
  });
});
