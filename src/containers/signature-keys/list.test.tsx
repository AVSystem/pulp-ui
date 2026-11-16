import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
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
