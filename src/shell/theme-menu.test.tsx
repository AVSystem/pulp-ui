import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { ThemeMenu } from './theme-menu';

const isDark = () =>
  document.firstElementChild?.classList.contains('pf-v6-theme-dark');

function stubSystemTheme(dark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: dark && query.includes('dark'),
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

describe('theme menu', () => {
  beforeEach(() => {
    window.localStorage.removeItem('pulp-darkmode');
    document.firstElementChild?.classList.remove('pf-v6-theme-dark');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.localStorage.removeItem('pulp-darkmode');
  });

  it('is one icon button named Theme with the hook the suites use', () => {
    stubSystemTheme(false);
    renderWithProviders(<ThemeMenu />);

    expect(screen.getByRole('button', { name: 'Theme' })).toHaveAttribute(
      'data-cy',
      'darkmode-dropdown',
    );
  });

  it('shows the sun in the light theme and the moon in the dark theme', () => {
    stubSystemTheme(false);
    const light = renderWithProviders(<ThemeMenu />);
    expect(light.container.querySelector('[data-icon="sun"]')).not.toBeNull();
    expect(light.container.querySelector('[data-icon="moon"]')).toBeNull();
    light.unmount();

    stubSystemTheme(true);
    const dark = renderWithProviders(<ThemeMenu />);
    expect(dark.container.querySelector('[data-icon="moon"]')).not.toBeNull();
    expect(dark.container.querySelector('[data-icon="sun"]')).toBeNull();
  });

  it('marks Match system as selected when nothing is stored', async () => {
    stubSystemTheme(false);
    const { user } = renderWithProviders(<ThemeMenu />);

    await user.click(screen.getByRole('button', { name: 'Theme' }));

    expect(screen.getByRole('menuitem', { name: 'Match system' })).toHaveClass(
      'pf-m-selected',
    );
    expect(screen.getByRole('menuitem', { name: 'Light' })).not.toHaveClass(
      'pf-m-selected',
    );
    expect(screen.getByRole('menuitem', { name: 'Dark' })).not.toHaveClass(
      'pf-m-selected',
    );
  });

  it('stores Dark, applies the dark class and marks Dark as selected', async () => {
    stubSystemTheme(false);
    const { user } = renderWithProviders(<ThemeMenu />);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('menuitem', { name: 'Dark' }));

    expect(window.localStorage.getItem('pulp-darkmode')).toBe('dark');
    expect(isDark()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    expect(screen.getByRole('menuitem', { name: 'Dark' })).toHaveClass(
      'pf-m-selected',
    );
  });

  it('removes the stored choice with Match system and follows the system', async () => {
    stubSystemTheme(false);
    window.localStorage.setItem('pulp-darkmode', 'dark');
    const { user } = renderWithProviders(<ThemeMenu />);
    expect(isDark()).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.click(screen.getByRole('menuitem', { name: 'Match system' }));

    expect(window.localStorage.getItem('pulp-darkmode')).toBeNull();
    expect(isDark()).toBe(false);
  });
});
