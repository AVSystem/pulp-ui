import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { PermissionChipSelector } from './permission-chip-selector';

const available = ['core.view_user', 'core.change_user', 'core.delete_user'];

describe('PermissionChipSelector', () => {
  it('shows the selected permissions as labels', () => {
    renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={['core.view_user']}
        onPermissionToggle={vi.fn()}
      />,
    );

    expect(screen.getByText('core.view_user')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });

  it('toggles a permission when its label is closed', async () => {
    const onPermissionToggle = vi.fn();
    const { user } = renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={['core.view_user']}
        onPermissionToggle={onPermissionToggle}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'close' }));

    expect(onPermissionToggle).toHaveBeenCalledTimes(1);
    expect(onPermissionToggle).toHaveBeenCalledWith('core.view_user');
  });

  it('narrows the options while typing and toggles the chosen one', async () => {
    const onPermissionToggle = vi.fn();
    const { user } = renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={[]}
        onPermissionToggle={onPermissionToggle}
      />,
    );

    await user.click(
      screen.getByRole('combobox', { name: 'Select permissions' }),
    );
    expect(await screen.findAllByRole('option')).toHaveLength(3);

    await user.type(screen.getByRole('combobox'), 'change');

    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getAllByRole('option')).toHaveLength(1);
    await user.click(
      within(listbox).getByRole('option', { name: 'core.change_user' }),
    );

    expect(onPermissionToggle).toHaveBeenCalledWith('core.change_user');
  });

  it('shows a disabled entry when nothing matches', async () => {
    const { user } = renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={[]}
        onPermissionToggle={vi.fn()}
      />,
    );

    await user.type(screen.getByRole('combobox'), 'nothing like it');

    expect(
      await screen.findByRole('option', { name: 'Not found' }),
    ).toBeDisabled();
  });

  it('calls onCategoryClear from the clear button', async () => {
    const onCategoryClear = vi.fn();
    const { user } = renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={['core.view_user']}
        onCategoryClear={onCategoryClear}
        onPermissionToggle={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(onCategoryClear).toHaveBeenCalledTimes(1);
  });

  it('disables the input when isDisabled is set', () => {
    renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={[]}
        isDisabled
        onPermissionToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('renders plain labels without an input in view-only mode', () => {
    renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={['core.view_user', 'core.delete_user']}
        isViewOnly
      />,
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'close' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('core.view_user')).toBeInTheDocument();
    expect(screen.getByText('core.delete_user')).toBeInTheDocument();
  });

  it('says there is no permission in view-only mode when none is selected', () => {
    renderWithProviders(
      <PermissionChipSelector
        availablePermissions={available}
        selectedPermissions={[]}
        isViewOnly
      />,
    );

    expect(screen.getByText('No permission')).toBeInTheDocument();
  });
});
