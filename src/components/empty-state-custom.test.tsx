import { Button } from '@patternfly/react-core';
import FlaskIcon from '@patternfly/react-icons/dist/esm/icons/flask-icon';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { AppliedFilters } from './applied-filters';
import { EmptyStateCustom } from './empty-state-custom';

describe('EmptyStateCustom', () => {
  it('renders the title as a level 4 heading, the description, the icon and the button', () => {
    const { container } = renderWithProviders(
      <EmptyStateCustom
        icon={FlaskIcon}
        title='Nothing here yet'
        description='Create the first one.'
        button={<Button>Create</Button>}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 4, name: 'Nothing here yet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Create the first one.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('[data-cy=EmptyState]')).not.toBeNull();
  });

  it('renders neither an icon nor a footer when none is given', () => {
    const { container } = renderWithProviders(
      <EmptyStateCustom title='Nothing here yet' description='Just text.' />,
    );

    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('.pf-v6-c-empty-state__footer')).toBeNull();
    expect(container.querySelector('.pf-v6-c-empty-state__icon')).toBeNull();
  });

  it('renders the footer with the button but without an icon', () => {
    const { container } = renderWithProviders(
      <EmptyStateCustom
        title='Nothing here yet'
        description='Just text.'
        button={<Button>Create</Button>}
      />,
    );

    expect(container.querySelector('svg')).toBeNull();
    expect(
      container.querySelector('.pf-v6-c-empty-state__footer'),
    ).not.toBeNull();
  });
});

describe('AppliedFilters', () => {
  it('names the close button of a label and calls the filter update when it is used', async () => {
    const updates: unknown[] = [];
    const { user } = renderWithProviders(
      <AppliedFilters
        params={{ name: 'alpha', page: 1 }}
        ignoredParams={['page']}
        updateParams={(p) => updates.push(p)}
      />,
    );

    expect(screen.getByText('alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'close' }));

    expect(updates).toHaveLength(1);
    expect(updates[0]).not.toHaveProperty('name');
    expect(updates[0]).toHaveProperty('page', 1);
  });
});
