import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { SyncModal } from './sync-modal';

const mirrorSwitch = () =>
  screen.getByRole('checkbox', {
    name: /Content not present in remote|Sync will only add/,
  });
const syncButton = () => screen.getByRole('button', { name: /^Sync/ });

describe('sync dialog, mirror switch', () => {
  it('starts with mirror on and lets the user turn it off', async () => {
    const syncAction = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <SyncModal
        closeAction={() => null}
        name='tools'
        syncAction={syncAction}
      />,
    );

    expect(mirrorSwitch()).toBeChecked();
    expect(mirrorSwitch()).toBeEnabled();
    await user.click(mirrorSwitch());
    await user.click(syncButton());

    await waitFor(() => expect(syncAction).toHaveBeenCalled());
    expect(syncAction).toHaveBeenCalledWith(
      expect.objectContaining({ mirror: false }),
    );
  });

  it('keeps mirror off and disabled with the reason when it is locked', async () => {
    const syncAction = vi.fn().mockResolvedValue(undefined);
    const { user } = renderWithProviders(
      <SyncModal
        closeAction={() => null}
        mirrorLockedReason='Mirroring cannot be combined with autopublish.'
        name='tools'
        syncAction={syncAction}
      />,
    );

    expect(mirrorSwitch()).not.toBeChecked();
    expect(mirrorSwitch()).toBeDisabled();
    expect(
      screen.getByText('Mirroring cannot be combined with autopublish.'),
    ).toBeInTheDocument();

    await user.click(mirrorSwitch());
    await user.click(syncButton());

    await waitFor(() => expect(syncAction).toHaveBeenCalled());
    expect(syncAction).toHaveBeenCalledWith(
      expect.objectContaining({ mirror: false }),
    );
  });

  it('shows no reason line when mirroring is allowed', () => {
    renderWithProviders(
      <SyncModal closeAction={() => null} name='tools' syncAction={vi.fn()} />,
    );

    expect(screen.queryByText(/cannot be combined/)).toBeNull();
  });
});
