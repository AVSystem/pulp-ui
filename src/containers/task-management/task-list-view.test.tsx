import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { listOf, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
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

describe('the task list after the same user signs in again', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));
  const signInAgain = (user) =>
    user.click(screen.getByRole('button', { name: 'Sign in again' }));
  const refused = http.get(`*${TASKS}`, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );
  const serve = (...names: string[]) =>
    server.use(
      listOf(
        TASKS,
        names.map((name) => task({ name })),
      ).handler,
    );

  function renderSignedIn() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );
  }

  it('reads the list again and shows the fresh rows', async () => {
    serve('zz.alpha');
    const { user } = renderSignedIn();
    await screen.findByText('zz.alpha');
    await signedIn();
    serve('zz.alpha', 'zz.beta');

    await signInAgain(user);

    expect(await screen.findByText('zz.beta')).toBeInTheDocument();
  });

  it('keeps its rows and shows no alert when the read is refused with 401', async () => {
    serve('zz.alpha');
    const { user } = renderSignedIn();
    await screen.findByText('zz.alpha');
    await signedIn();
    server.use(refused);

    await signInAgain(user);
    await pause();

    expect(screen.getByText('zz.alpha')).toBeInTheDocument();
    expect(screen.queryByText('Tasks list could not be displayed.')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('keeps the spinner and shows no alert when the first read is refused, and lists after signing in', async () => {
    server.use(refused);
    const { user } = renderSignedIn();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText('Tasks list could not be displayed.')).toBeNull();
    serve('zz.alpha');

    await signInAgain(user);

    expect(await screen.findByText('zz.alpha')).toBeInTheDocument();
  });

  it('sends no write', async () => {
    serve('zz.alpha');
    const recorded = recordWrites();
    const { user } = renderSignedIn();
    await screen.findByText('zz.alpha');
    await signedIn();

    await signInAgain(user);
    await pause();

    expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
    recorded.stop();
    await waitFor(() => expect(screen.getByText('zz.alpha')).toBeVisible());
  });
});
