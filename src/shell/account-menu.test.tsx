import { screen, within } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { AccountMenu, initialsOf } from './account-menu';

function Where() {
  return <p data-testid='where'>{useLocation().pathname}</p>;
}

function renderAccount(
  username: string | undefined,
  logout = vi.fn(),
  { includeHelp = false, showAbout = vi.fn() } = {},
) {
  return {
    logout,
    showAbout,
    ...renderWithProviders(
      <>
        <AccountMenu
          username={username}
          logout={logout}
          includeHelp={includeHelp}
          showAbout={showAbout}
        />
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
      screen.getByRole('menuitem', { name: 'Logout' }),
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
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }));

    expect(logout).toHaveBeenCalledTimes(1);
  });
});

describe('account menu with the help items', () => {
  const open = async (options = {}) => {
    const rendered = renderAccount('anna.k', vi.fn(), {
      includeHelp: true,
      ...options,
    });
    await rendered.user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );
    return rendered;
  };

  it('has a Help group with the help items and the language items between the profile and Logout', async () => {
    await open();

    expect(screen.getByRole('heading', { name: 'Help' })).toBeInTheDocument();
    const items = screen
      .getAllByRole('menuitem')
      .map((item) => item.textContent);
    expect(items.slice(0, 5)).toEqual([
      'My profile',
      'Documentation',
      'About Pulp UI',
      'About project',
      'English (browser default)',
    ]);
    expect(items.at(-1)).toBe('Logout');
    expect(
      screen.getByRole('menuitem', { name: 'Reset to browser defaults' }),
    ).toBeInTheDocument();
  });

  it('opens the documentation in a new tab without opener access', async () => {
    await open();

    const link = screen.getByRole('menuitem', { name: /Documentation/ });
    expect(link).toHaveAttribute('href', 'https://docs.pulpproject.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens the About dialog and the page about the project', async () => {
    const { user, showAbout } = await open();

    await user.click(screen.getByRole('menuitem', { name: 'About Pulp UI' }));
    expect(showAbout).toHaveBeenCalledTimes(1);

    await user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'About project' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/about');
  });

  it('leaves the Help group out unless asked for it', async () => {
    const { user } = renderAccount('anna.k');
    await user.click(
      screen.getByRole('button', { name: 'Account menu for anna.k' }),
    );

    expect(screen.queryByRole('heading', { name: 'Help' })).toBeNull();
    expect(
      screen.queryByRole('menuitem', { name: /Documentation/ }),
    ).toBeNull();
  });
});
