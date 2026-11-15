import { DropdownItem } from '@patternfly/react-core';
import menuToggleStyles from '@patternfly/react-styles/css/components/MenuToggle/menu-toggle.mjs';
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { StatefulDropdown } from './stateful-dropdown';

const items = [
  <DropdownItem key='one'>First</DropdownItem>,
  <DropdownItem key='two'>Second</DropdownItem>,
];

describe('StatefulDropdown', () => {
  it('renders a kebab toggle with an accessible name and the test hook', () => {
    renderWithProviders(<StatefulDropdown items={items} data-cy='actions' />);

    const toggle = screen.getByRole('button', { name: 'Actions' });

    expect(toggle).toHaveAttribute('data-cy', 'actions');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('names the toggle after ariaLabel when one is given', () => {
    renderWithProviders(
      <StatefulDropdown items={items} ariaLabel='User dropdown' />,
    );

    expect(
      screen.getByRole('button', { name: 'User dropdown' }),
    ).toBeInTheDocument();
  });

  it('shows the items as menu items once the toggle is clicked', async () => {
    const { user } = renderWithProviders(<StatefulDropdown items={items} />);

    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions' }));

    expect(
      await screen.findByRole('menuitem', { name: 'First' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Second' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('calls onSelect with the event and closes the menu when an item is chosen', async () => {
    const onSelect = vi.fn();
    const { user } = renderWithProviders(
      <StatefulDropdown items={items} onSelect={onSelect} />,
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Second' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toHaveProperty('type', 'click');
    await waitFor(() =>
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument(),
    );
  });

  it('runs the click handler of the chosen item', async () => {
    const onClick = vi.fn();
    const { user } = renderWithProviders(
      <StatefulDropdown
        items={[
          <DropdownItem key='one' onClick={onClick}>
            First
          </DropdownItem>,
        ]}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'First' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('closes the menu when Escape is pressed', async () => {
    const { user } = renderWithProviders(<StatefulDropdown items={items} />);

    await user.click(screen.getByRole('button', { name: 'Actions' }));
    await screen.findByRole('menuitem', { name: 'First' });
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('menuitem')).not.toBeInTheDocument(),
    );
  });

  it('shows the default text on a dropdown toggle', () => {
    renderWithProviders(
      <StatefulDropdown
        items={items}
        toggleType='dropdown'
        defaultText='Pick one'
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Pick one' }),
    ).toBeInTheDocument();
  });

  it('shows the generic text on a dropdown toggle without a default text', () => {
    renderWithProviders(
      <StatefulDropdown items={items} toggleType='dropdown' />,
    );

    expect(
      screen.getByRole('button', { name: 'Dropdown' }),
    ).toBeInTheDocument();
  });

  it('shows the icon content of an icon toggle without a dropdown indicator', () => {
    const { container } = renderWithProviders(
      <>
        <StatefulDropdown
          items={items}
          toggleType='icon'
          defaultText='EN'
          ariaLabel='Select language'
          data-cy='language'
        />
        <StatefulDropdown
          items={items}
          toggleType='dropdown'
          defaultText='EN'
          data-cy='with-indicator'
        />
      </>,
    );

    const icon = container.querySelector('[data-cy=language]');
    const withIndicator = container.querySelector('[data-cy=with-indicator]');

    expect(icon).toHaveTextContent('EN');
    expect(
      icon?.querySelector(`.${menuToggleStyles.menuToggleControls}`),
    ).toBeNull();
    expect(
      withIndicator?.querySelector(`.${menuToggleStyles.menuToggleControls}`),
    ).not.toBeNull();
  });

  it.each([
    ['left', 'bottom-start'],
    [undefined, 'bottom-end'],
  ] as const)(
    'aligns the menu for position %s to %s of the toggle',
    async (position, placement) => {
      const { user } = renderWithProviders(
        <StatefulDropdown items={items} position={position} />,
      );

      await user.click(screen.getByRole('button', { name: 'Actions' }));
      const menu = (await screen.findByRole('menu')).closest(
        '[data-popper-placement]',
      );

      await waitFor(() =>
        expect(menu).toHaveAttribute('data-popper-placement', placement),
      );
    },
  );
});
