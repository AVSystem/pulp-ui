import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setPageUrl } from 'src/test-utils/page';
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
