import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PulpMenu } from './menu';

describe('navigation menu', () => {
  it('offers no entry for the galaxy_ng approval and import workflows', async () => {
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({
          username: 'zoe',
          pulp_href: '/pulp/api/v3/users/1/',
        }),
      ),
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          versions: [{ component: 'ansible', version: '0.30.0' }],
        }),
      ),
    );

    renderWithProviders(<PulpMenu />, { route: '/ansible/repositories' });

    // The Ansible section is built once the session and the installed
    // plugins are known.
    expect(await screen.findByText('Pulp Ansible')).toBeInTheDocument();
    expect(await screen.findByText('Repositories')).toBeInTheDocument();
    expect(screen.queryByText('Approvals')).not.toBeInTheDocument();
    expect(screen.queryByText('Imports')).not.toBeInTheDocument();
  });
});
