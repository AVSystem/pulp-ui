import tabsStyles from '@patternfly/react-styles/css/components/Tabs/tabs.mjs';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { LinkTabs } from './link-tabs';

const TABS = [
  { title: 'Details', link: '/things/a/details', active: true },
  { title: 'Versions', link: '/things/a/versions' },
  { title: 'Access', link: '/things/a/access', icon: <i data-testid='icon' /> },
];

describe('link tabs', () => {
  it('renders one router link per tab', () => {
    renderWithProviders(<LinkTabs tabs={TABS} />);

    expect(
      screen.getAllByRole('link').map((a) => a.getAttribute('href')),
    ).toEqual(['/things/a/details', '/things/a/versions', '/things/a/access']);
    expect(screen.getByRole('link', { name: 'Versions' })).toBeInTheDocument();
  });

  it('marks only the tab of the current route as current', () => {
    renderWithProviders(<LinkTabs tabs={TABS} />);

    const current = screen.getByRole('link', { name: 'Details' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(current.closest('li')).toHaveClass(tabsStyles.modifiers.current);

    for (const name of ['Versions', 'Access']) {
      const other = screen.getByRole('link', { name });
      expect(other).not.toHaveAttribute('aria-current');
      expect(other.closest('li')).not.toHaveClass(tabsStyles.modifiers.current);
    }
  });

  it('takes every class from the Tabs class map', () => {
    const { container } = renderWithProviders(<LinkTabs tabs={TABS} />);

    const root = container.firstElementChild;
    expect(root).toHaveClass(tabsStyles.tabs);
    expect(root?.querySelector('ul')).toHaveClass(tabsStyles.tabsList);

    const item = screen.getByRole('link', { name: 'Versions' }).closest('li');
    expect(item).toHaveClass(tabsStyles.tabsItem);
    expect(screen.getByRole('link', { name: 'Versions' })).toHaveClass(
      tabsStyles.tabsLink,
    );
    expect(
      screen.getByRole('link', { name: 'Versions' }).querySelector('span'),
    ).toHaveClass(tabsStyles.tabsItemText);
  });

  it('shows the icon of a tab in front of its title', () => {
    renderWithProviders(<LinkTabs tabs={TABS} />);

    const link = screen.getByRole('link', { name: 'Access' });
    expect(link.querySelector('[data-testid=icon]')).not.toBeNull();
  });

  it('skips empty entries', () => {
    renderWithProviders(<LinkTabs tabs={[null, TABS[0], undefined]} />);

    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
