import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PulpAboutModal } from './pulp-about-modal';

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

describe('about dialog', () => {
  it('shows the core version the server reports', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'core', version: '3.77.1' }],
        }),
      ),
    );

    renderWithProviders(
      <PulpAboutModal isOpen onClose={() => undefined} username='zoe' />,
    );

    expect(await screen.findByRole('link', { name: '3.77.1' })).toBeVisible();
  });

  it('does not fail when the server does not report the core component', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'file', version: '3.0.0' }],
        }),
      ),
    );

    renderWithProviders(
      <PulpAboutModal isOpen onClose={() => undefined} username='zoe' />,
    );

    expect(await screen.findByText('Pulp core version')).toBeVisible();
  });
});
