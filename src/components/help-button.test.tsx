import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { HelpButton } from './help-button';

describe('HelpButton', () => {
  it('is a button with a name even though it shows only an icon', () => {
    renderWithProviders(<HelpButton content='What the field means.' />);

    expect(
      screen.getByRole('button', { name: 'More information' }),
    ).toBeInTheDocument();
  });

  it('opens the help text', async () => {
    const { user } = renderWithProviders(
      <HelpButton content='What the field means.' />,
    );

    await user.click(screen.getByRole('button', { name: 'More information' }));

    expect(await screen.findByText('What the field means.')).toBeVisible();
  });
});
