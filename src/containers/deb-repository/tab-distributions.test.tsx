import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { DistributionsTab } from './tab-distributions';

describe('deb repository Distributions tab', () => {
  it('asks the page to load again when Retry is pressed, because the page loaded the distributions', async () => {
    const query = vi.fn();
    renderWithProviders(
      <DistributionsTab
        item={
          {
            ...repository({ name: 'tools' }),
            distributions: [],
            distributionsError: 'Error 500 - the server failed',
          } as never
        }
        actionContext={{
          addAlert: vi.fn(),
          query,
          state: { params: {} },
          hasPermission: () => true,
        }}
      />,
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(query).toHaveBeenCalledTimes(1);
  });
});
