import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { taskAlert } from './task-alert';

const ID = '0192e5a1-0000-7000-8000-000000000001';

function show(task: unknown) {
  const alert = taskAlert(task, 'Started');
  render(<MemoryRouter>{alert.description}</MemoryRouter>);
}

describe('the task alert', () => {
  it.each([
    ['an address', `/pulp/api/v3/tasks/${ID}/`],
    ['an object holding the address', { task: `/pulp/api/v3/tasks/${ID}/` }],
    ['a bare id', ID],
  ])('links to /tasks/<id> from %s', (_name, task) => {
    show(task);

    expect(screen.getByRole('link', { name: /detail page/ })).toHaveAttribute(
      'href',
      `/tasks/${ID}/`,
    );
  });

  it('shows no link when there is no task', () => {
    show(null);

    expect(screen.queryByRole('link')).toBeNull();
  });
});
