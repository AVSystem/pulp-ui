import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import TaskDetail from './task-detail';

const task = {
  pulp_href: '/pulp/api/v3/tasks/0192e5a1-0000-7000-8000-000000000001/',
  name: 'pulpcore.app.tasks.orphan.orphan_cleanup',
  state: 'completed',
  created_at: '2026-01-01T00:00:00Z',
  finished_at: '2026-01-01T00:01:00Z',
  parent_task: null,
  child_tasks: [],
  task_group: null,
  error: null,
  progress_reports: [
    { message: 'Clean up orphan Content', code: 'clean-up.content', done: 3 },
    {
      message: 'Clean up orphan Artifacts',
      code: 'clean-up.artifacts',
      done: 1,
    },
  ],
  reserved_resources_record: ['pdrn:1:alpha', 'pdrn:1:beta'],
};

function renderDetail() {
  server.use(
    http.get('*/pulp/api/v3/tasks/:id/', () => HttpResponse.json(task)),
  );
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route path='/tasks/:task' element={<TaskDetail />} />
      </Routes>
    </AppContextProvider>,
    { route: '/tasks/0192e5a1-0000-7000-8000-000000000001' },
  );
}

describe('task detail', () => {
  it('keeps every description list free of anything but its groups', async () => {
    const { container } = renderDetail();

    await screen.findByText('Reserve resources');

    const lists = Array.from(container.querySelectorAll('dl'));
    // task, groups, one per reserved resource (2), one per progress message (2)
    expect(lists.length).toBeGreaterThanOrEqual(6);
    for (const list of lists) {
      const children = Array.from(list.children).map((child) =>
        child.tagName.toLowerCase(),
      );
      expect(children.every((tag) => ['div', 'dt', 'dd'].includes(tag))).toBe(
        true,
      );
    }
  });

  it('still separates the resources and the progress messages from each other', async () => {
    const { container } = renderDetail();

    await screen.findByText('Reserve resources');

    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(container.querySelectorAll('section hr').length).toBe(3);
  });
});
