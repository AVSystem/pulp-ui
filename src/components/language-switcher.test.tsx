import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { LanguageSwitcher } from './language-switcher';

const { languages } = vi.hoisted(() => ({ languages: ['en', 'nl'] }));

vi.mock('src/l10n', () => ({
  availableLanguages: languages,
  language: 'en',
  languageNames: { en: 'English', nl: 'Nederlands' },
}));

describe('language switcher', () => {
  it('is an icon button with the language hook when there is a choice', async () => {
    const { user } = renderWithProviders(<LanguageSwitcher />);

    const toggle = screen.getByRole('button', { name: 'Select language' });
    expect(toggle).toHaveAttribute('data-cy', 'language-dropdown');

    await user.click(toggle);
    expect(
      screen.getByRole('menuitem', { name: 'Nederlands' }),
    ).toHaveAttribute('href', '?lang=nl');
  });

  it('is absent when only one language is available', () => {
    languages.splice(0, languages.length, 'en');

    renderWithProviders(<LanguageSwitcher />);

    expect(
      screen.queryByRole('button', { name: 'Select language' }),
    ).toBeNull();
  });
});
