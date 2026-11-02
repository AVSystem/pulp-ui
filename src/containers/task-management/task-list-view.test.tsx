import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import TaskListView from './task-list-view';

const TASKS = '/pulp/api/v3/tasks/';

function renderTasks() {
  return renderWithProviders(
    <AppContextProvider>
      <TaskListView />
    </AppContextProvider>,
    { route: '/task-management' },
  );
}

describe('the task list', () => {
  it('shows a readable message and no spinner when the request fails without a response', async () => {
    server.use(http.get(`*${TASKS}`, () => HttpResponse.error()));
    renderTasks();

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/network|failed|fetch/i)).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('shows the permission message when the server answers 403', async () => {
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json(
          { detail: 'no' },
          { status: 403, statusText: 'Forbidden' },
        ),
      ),
    );
    renderTasks();

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Error 403 - Forbidden: Forbidden: You do not have/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
