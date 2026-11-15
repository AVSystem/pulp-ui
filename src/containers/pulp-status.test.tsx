import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PulpStatus from './pulp-status';

const status = {
  versions: [{ component: 'core', version: '3.0.0' }],
  online_workers: [],
  online_api_apps: [],
  online_content_apps: [],
  database_connection: { connected: true },
  redis_connection: { connected: true },
  storage: { total: null, used: null, free: null },
  content_settings: {
    content_origin: 'https://pulp.example.com',
    content_path_prefix: '/pulp/content/',
  },
  domain_enabled: false,
};

describe('status page', () => {
  beforeEach(() => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(status)),
    );
  });

  it('names the toggle of the JSON card and reports whether it is open', async () => {
    const { user } = renderWithProviders(
      <AppContextProvider>
        <PulpStatus />
      </AppContextProvider>,
      { route: '/status' },
    );

    const toggle = await screen.findByRole('button', { name: 'JSON' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });
});
