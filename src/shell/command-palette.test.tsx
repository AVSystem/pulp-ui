import { fireEvent, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { CommandPalette } from './command-palette';

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

// Shows where the router is, so a test can see where a choice led.
const Where = () => (
  <output data-testid='where'>{useLocation().pathname}</output>
);

function renderPalette() {
  return renderWithProviders(
    <>
      <input aria-label='Some field' />
      <CommandPalette />
      <Where />
    </>,
    { route: '/tasks' },
  );
}

const trigger = () =>
  screen.findByRole('button', { name: 'Search or go to...' });
const input = () => screen.findByRole('combobox');
const where = () => screen.getByTestId('where').textContent;

// The names of the options in the order they are listed.
const optionNames = () =>
  screen.getAllByRole('option').map((option) => option.textContent);

// Waits until the screens of the menu are known, which they are once the list
// of installed plugins has answered.
async function openPalette(user: ReturnType<typeof renderPalette>['user']) {
  await user.click(await trigger());
  await input();
}

describe('search trigger', () => {
  it('is a button that names the shortcut for assistive technology', async () => {
    signIn();
    renderPalette();

    const button = await trigger();

    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+K Meta+K');
    expect(button).toHaveTextContent('Search or go to...');
    expect(button.querySelector('kbd')).toHaveTextContent(/^(Ctrl|Cmd) K$/);
  });

  it('opens the palette when clicked', async () => {
    signIn();
    const { user } = renderPalette();

    await user.click(await trigger());

    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });
});

describe('keyboard shortcut', () => {
  it('opens the palette with Ctrl+K inside a text field and cancels the browser action', async () => {
    signIn();
    renderPalette();
    const field = screen.getByRole('textbox', { name: 'Some field' });
    field.focus();

    const notCancelled = fireEvent.keyDown(field, { key: 'k', ctrlKey: true });

    expect(notCancelled).toBe(false);
    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });

  it('opens the palette with Cmd+K and cancels the browser action', async () => {
    signIn();
    renderPalette();

    const notCancelled = fireEvent.keyDown(document.body, {
      key: 'K',
      metaKey: true,
    });

    expect(notCancelled).toBe(false);
    expect(
      await screen.findByRole('dialog', { name: 'Search or go to' }),
    ).toBeVisible();
  });

  it('does nothing for Ctrl+Alt+K', async () => {
    signIn();
    renderPalette();
    await trigger();

    const notCancelled = fireEvent.keyDown(document.body, {
      key: 'k',
      ctrlKey: true,
      altKey: true,
    });

    expect(notCancelled).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does nothing for K alone', async () => {
    signIn();
    renderPalette();
    await trigger();

    fireEvent.keyDown(document.body, { key: 'k' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('palette', () => {
  it('focuses a combobox that controls a listbox of options', async () => {
    signIn();
    const { user } = renderPalette();

    await openPalette(user);

    const box = await input();
    expect(box).toHaveFocus();
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute(
      'placeholder',
      'Search screens and repositories',
    );
    const list = screen.getByRole('listbox');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
    expect(
      screen.getByText('Up and Down to move, Enter to open, Esc to close'),
    ).toBeVisible();
  });

  it('lists up to 8 reachable screens in sidebar order for an empty query without any request', async () => {
    // Any request without a handler fails the test (msw onUnhandledRequest).
    signIn();
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    expect(optionNames()).toEqual([
      'Repositories - File',
      'Repositories - deb',
      'Repositories - RPM',
      'Repositories - Python',
      'Repositories - Ansible',
      'Packages and artifacts - RPM',
      'Packages and artifacts - Python',
      'Remotes - File',
    ]);
    expect(screen.getByText('Go to')).toBeVisible();
  });

  it('announces the number of results politely', async () => {
    signIn();
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    const live = document.querySelector('[aria-live="polite"]');
    expect(live).toHaveTextContent('8 results');
  });

  it('filters screens by a case-insensitive substring from the first character', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.type(await input(), 'u');

    expect(optionNames()).toEqual([
      'Workers and status',
      'Users and groups - Users',
      'Users and groups - Groups',
    ]);
  });

  it('opens the highlighted screen with Enter and closes', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.type(await input(), 'Rem');
    await user.keyboard('{ArrowDown}');
    const box = await input();
    const highlighted = screen.getByRole('option', {
      name: 'Remotes - deb',
    });
    expect(box.getAttribute('aria-activedescendant')).toBe(highlighted.id);
    await user.keyboard('{Enter}');

    expect(where()).toMatch(/^\/deb\/remotes\/?$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens a screen with a click', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    await user.click(
      await screen.findByRole('option', { name: 'Repositories - deb' }),
    );

    expect(where()).toMatch(/^\/deb\/repositories\/?$/);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('moves the highlight with Up and Down and wraps at both ends', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');
    const box = await input();
    const names = optionNames();
    const active = () =>
      screen
        .getAllByRole('option')
        .findIndex(
          (option) => option.id === box.getAttribute('aria-activedescendant'),
        );

    expect(active()).toBe(0);
    await user.keyboard('{ArrowUp}');
    expect(active()).toBe(names.length - 1);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(0);
    await user.keyboard('{ArrowDown}');
    expect(active()).toBe(1);
  });

  it('closes on Escape and returns the focus to the trigger', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await trigger()).toHaveFocus();
  });

  it('keeps the Tab key inside the modal', async () => {
    signIn();
    const { user } = renderPalette();
    await openPalette(user);
    await screen.findAllByRole('option');

    await user.tab();
    await user.tab();
    await user.tab();

    expect(
      within(screen.getByRole('dialog')).queryByRole('combobox'),
    ).not.toBeNull();
    expect(screen.getByRole('dialog')).toContainElement(
      document.activeElement as HTMLElement,
    );
  });

  it('offers the sign-in screen and the status screen to a visitor who is not signed in', async () => {
    const { user } = renderPalette();

    await openPalette(user);
    await screen.findAllByRole('option');

    expect(optionNames()).toEqual(['Login', 'Workers and status']);
  });
});
