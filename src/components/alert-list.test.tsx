import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test-utils/render';
import { AlertList } from './alert-list';

describe('the alert list', () => {
  it('announces a danger alert through a live region', () => {
    renderWithProviders(
      <AlertList
        alerts={[{ variant: 'danger', title: 'Could not save' }]}
        closeAlert={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Could not save').closest('[aria-live]'),
    ).toHaveAttribute('aria-live', 'polite');
  });

  it('announces an alert marked live even when it is not a failure', () => {
    renderWithProviders(
      <AlertList
        alerts={[{ variant: 'success', title: 'Finished', live: true }]}
        closeAlert={vi.fn()}
      />,
    );

    expect(screen.getByText('Finished').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it('leaves a plain success alert out of the live regions', () => {
    renderWithProviders(
      <AlertList
        alerts={[{ variant: 'success', title: 'Saved' }]}
        closeAlert={vi.fn()}
      />,
    );

    expect(screen.getByText('Saved').closest('[aria-live]')).toBeNull();
  });

  it('shows the description of an alert and closes it by its index', async () => {
    const closeAlert = vi.fn();
    const { user } = renderWithProviders(
      <AlertList
        alerts={[
          { variant: 'success', title: 'Saved' },
          {
            variant: 'danger',
            title: 'Could not save',
            description: <p>because</p>,
          },
        ]}
        closeAlert={closeAlert}
      />,
    );

    expect(screen.getByText('because')).toBeInTheDocument();
    const [, close] = screen.getAllByRole('button', { name: /close/i });
    await user.click(close);

    expect(closeAlert).toHaveBeenCalledWith(1);
  });

  it('bounds the list by a class instead of inline positioning', () => {
    const { container } = renderWithProviders(
      <AlertList
        alerts={[{ variant: 'danger', title: 'Could not save' }]}
        closeAlert={vi.fn()}
      />,
    );

    const list = container.querySelector('[data-cy="AlertList"]');
    expect(list).toHaveClass('pulp-alert-list');
    expect(list).not.toHaveAttribute('style');
  });
});
