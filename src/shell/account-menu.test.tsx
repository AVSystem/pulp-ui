import { screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { AccountMenu, initialsOf } from './account-menu';

function Where() {
  return <p data-testid='where'>{useLocation().pathname}</p>;
}

function renderAccount(username: string | undefined, logout = vi.fn()) {
  return {
    logout,
    ...renderWithProviders(
      <>
        <AccountMenu username={username} logout={logout} />
        <Routes>
          <Route path='*' element={<Where />} />
        </Routes>
      </>,
    ),
  };
}

describe('initials', () => {
  it.each([
    ['anna.k', 'AK'],
    ['jan-nowak', 'JN'],
    ['admin', 'AD'],
    ['a_b_c', 'AB'],
    ['Zoe', 'ZO'],
    ['x', 'X'],
    ['.lead.dot', 'LD'],
    ['', ''],
  ])('takes %s to %s', (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe('account menu', () => {
  it('shows the avatar initials and the username, named for the user', () => {
    renderAccount('anna.k');

    const toggle = screen.getByRole('button', {
      name: 'Account menu for anna.k',
    });
    expect(toggle).toHaveAttribute('data-cy', 'user-dropdown');
    expect(toggle).toHaveTextContent('AK');
    expect(within(toggle).getByText('anna.k')).toBeInTheDocument();
  });

  it('shows no initials and is named Account before the user is known', () => {
    renderAccount(undefined);

    const toggle = screen.getByRole('button', { name: 'Account' });
    expect(toggle).toHaveAttribute('data-cy', 'user-dropdown');
    expect(toggle.querySelector('.pulp-account__avatar')).toBeNull();
  });

  it('keeps a long username on one line and the full name in a title', () => {
    const long = 'a-very-long-username-'.repeat(3).slice(0, 60);
    renderAccount(long);

    const name = screen.getByText(long);
    expect(name).toHaveAttribute('title', long);
    expect(name).toHaveClass('pulp-account__name');
  });

  it('renders a username with markup as plain text', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    renderAccount(hostile);

    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });

  it('opens a menu with who is signed in, My profile and Logout', async () => {
    const { user } = renderAccount('anna.k');

    await user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );

    expect(screen.getByText('Signed in as anna.k')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Signed in as/ })).toBeNull();
    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items).toEqual(['My profile', 'Logout']);
    expect(
      screen.getByRole('menuitem', { name: 'logout' }),
    ).toBeInTheDocument();
  });

  it('goes to the profile from My profile', async () => {
    const { user } = renderAccount('anna.k');

    await user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'My profile' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/users/profile');
  });

  it('signs out from Logout', async () => {
    const { user, logout } = renderAccount('anna.k');

    await user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'logout' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});
