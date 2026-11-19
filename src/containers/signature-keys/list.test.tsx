import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { render, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { dataRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { listOf, signingService } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import SignatureKeysList from './list';

const download = vi.hoisted(() => vi.fn());
vi.mock('src/utilities/download-data', () => ({
  downloadString: download,
}));

afterEach(() => {
  server.events.removeAllListeners();
  download.mockReset();
});

describe('the signing services list', () => {
  it('saves the public key of a row as a named .asc file', async () => {
    server.use(
      listOf('/pulp/api/v3/signing-services/', [
        signingService({ name: 'zz-signer', public_key: 'zz public key' }),
      ]).handler,
    );
    servePermissions({ isStaff: true });
    const assigned = vi.spyOn(document, 'location', 'set');

    const { user } = renderWithProviders(
      <AppContextProvider>
        <PermissionsKnown>
          <SignatureKeysList />
        </PermissionsKnown>
      </AppContextProvider>,
      { route: '/signature-keys' },
    );

    const row = (await screen.findByText('zz-signer')).closest(
      'tr',
    ) as HTMLElement;
    await user.click(
      within(row).getByRole('button', { name: /actions|kebab/i }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Download key' }),
    );

    expect(download).toHaveBeenCalledTimes(1);
    expect(download).toHaveBeenCalledWith('zz public key', 'zz-signer.asc');
    expect(assigned).not.toHaveBeenCalled();
    assigned.mockRestore();
  });
});

describe('opening the signing services list by address', () => {
  it('asks who is signed in once for a viewer', async () => {
    servePermissions({ isStaff: false });
    const sessionReads: string[] = [];
    server.events.on('request:start', ({ request }) => {
      if (
        request.method === 'GET' &&
        new URL(request.url).pathname.endsWith('/pulp/api/v3/login/')
      ) {
        sessionReads.push(request.url);
      }
    });

    const router = createMemoryRouter(dataRoutes, {
      initialEntries: ['/signature-keys'],
    });
    render(
      <I18nProvider i18n={i18n}>
        <RouterProvider router={router} />
      </I18nProvider>,
    );

    expect(
      (await screen.findAllByText('Insufficient permissions')).length,
    ).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(sessionReads).toHaveLength(1);
  });
});
