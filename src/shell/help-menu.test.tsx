import { screen } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { HelpMenu } from './help-menu';

function Where() {
  return <p data-testid='where'>{useLocation().pathname}</p>;
}

function renderHelp(showAbout = () => undefined) {
  return renderWithProviders(
    <>
      <HelpMenu showAbout={showAbout} />
      <Routes>
        <Route path='*' element={<Where />} />
      </Routes>
    </>,
  );
}

describe('help menu', () => {
  it('is an icon button named Help with the docs hook', () => {
    renderHelp();

    const toggle = screen.getByRole('button', { name: 'Help' });
    expect(toggle).toHaveAttribute('data-cy', 'docs-dropdown');
  });

  it('opens a link to the documentation in a new tab without opener access', async () => {
    const { user } = renderHelp();

    await user.click(screen.getByRole('button', { name: 'Help' }));

    const link = screen.getByRole('menuitem', { name: /Documentation/ });
    expect(link).toHaveAttribute('href', 'https://docs.pulpproject.org/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('opens the About dialog from About Pulp UI', async () => {
    let opened = 0;
    const { user } = renderHelp(() => {
      opened += 1;
    });

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About Pulp UI' }));

    expect(opened).toBe(1);
  });

  it('goes to the project page from About project', async () => {
    const { user } = renderHelp();

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'About project' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/about');
  });
});
