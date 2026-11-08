import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useRoutes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { resetPluginVersionsCache } from 'src/utilities/plugin-version';
import { dataRoutes } from './app-routes';
import { PulpMenu } from './menu';

const guardedRoutes = (dataRoutes[0]?.children?.[0]?.children ?? []).filter(
  (route) => 'path' in route,
);

// A page as the application lays it out: the menu next to the routed screen.
function MenuAndRoutes() {
  return (
    <>
      <PulpMenu />
      {useRoutes(guardedRoutes)}
    </>
  );
}

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

function reportPlugins(components: string[]) {
  server.use(
    http.get('*/pulp/api/v3/status/', () =>
      HttpResponse.json({
        versions: components.map((component) => ({
          component,
          version: '3.0.0',
        })),
      }),
    ),
  );
}

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

  it('shares one read of the installed plugins with the screen it is shown beside', async () => {
    signIn();
    const statusRequests: string[] = [];
    const onStart = ({ request }: { request: Request }) => {
      const { pathname } = new URL(request.url);
      if (pathname.endsWith('/status/')) {
        statusRequests.push(pathname);
      }
    };
    server.events.on('request:start', onStart);

    renderWithProviders(<MenuAndRoutes />, { route: '/ansible/collections' });

    expect(await screen.findByText('Pulp Ansible')).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Collections', level: 1 }),
    ).toBeVisible();
    server.events.removeListener('request:start', onStart);

    expect(statusRequests).toHaveLength(1);
  });

  it('offers the RPM section only when the server reports the plugin', async () => {
    signIn();
    reportPlugins(['core', 'file', 'rpm']);

    const withRpm = renderWithProviders(<PulpMenu />);
    expect(await screen.findByText('Pulp RPM')).toBeInTheDocument();
    expect(screen.getByText('Pulp file')).toBeInTheDocument();
    withRpm.unmount();

    // A new page load reads the plugins again.
    resetPluginVersionsCache();
    reportPlugins(['core', 'file']);
    renderWithProviders(<PulpMenu />);
    expect(await screen.findByText('Pulp file')).toBeInTheDocument();
    expect(screen.queryByText('Pulp RPM')).not.toBeInTheDocument();
  });

  it('shows no plugin section and raises no unhandled rejection when the plugins cannot be read', async () => {
    signIn();
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Failed.' }, { status: 500 }),
      ),
    );
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);

    try {
      renderWithProviders(<PulpMenu />);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(screen.queryByText('Pulp RPM')).not.toBeInTheDocument();
    expect(screen.queryByText('Pulp file')).not.toBeInTheDocument();
    expect(rejections).toEqual([]);
  });
});
