import { act, screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import { servePermissions } from 'src/test-utils/permissions';
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
      screen.getByText('You do not have permission to do this.'),
    ).toBeInTheDocument();
    expect(screen.getByText('no')).toBeInTheDocument();
    expect(screen.queryByText(/Error 403/)).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

const ADMIN_ACTIONS = ['Orphan cleanup', 'Repair', 'Purge tasks'];

describe('the toolbar actions of the task list', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  function Known() {
    const { permissionsReady } = useAppContext();
    return (
      <p>{permissionsReady ? 'permissions known' : 'permissions pending'}</p>
    );
  }

  function renderToolbar() {
    server.use(listOf(TASKS, [task({ name: 'zz.alpha' })]).handler);
    return renderWithProviders(
      <AppContextProvider>
        <Known />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );
  }

  const shown = () =>
    ADMIN_ACTIONS.filter((name) => screen.queryByRole('button', { name }));

  it('offers a viewer none of the maintenance actions and leaves no empty toolbar item', async () => {
    servePermissions({ own: [['core.view_task']] });
    const { container } = renderToolbar();

    await screen.findByText('zz.alpha');
    await screen.findByText('permissions known');

    for (const name of ADMIN_ACTIONS) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // only the filter is left in the toolbar: no item without content
    const items = Array.from(
      container.querySelectorAll('.pf-v6-c-toolbar__item'),
    );
    expect(items).toHaveLength(1);
    expect(items[0].textContent).not.toBe('');
  });

  it('offers a holder of the delete permission only Purge tasks', async () => {
    servePermissions({ own: [['core.delete_task']] });
    renderToolbar();

    await screen.findByText('zz.alpha');
    await screen.findByText('permissions known');

    expect(shown()).toEqual(['Purge tasks']);
  });

  it('offers staff all three actions', async () => {
    servePermissions({ isStaff: true });
    renderToolbar();

    await screen.findByText('zz.alpha');
    await screen.findByText('permissions known');

    expect(shown()).toEqual(ADMIN_ACTIONS);
  });

  it('offers none of them while the permissions are pending', async () => {
    servePermissions({ isStaff: true });
    // the own record answers late, so the permissions stay unknown
    server.use(
      http.get('*/pulp/api/v3/users/7/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json({ id: 7, is_staff: true, groups: [] });
      }),
    );
    renderToolbar();

    await screen.findByText('zz.alpha');
    expect(screen.getByText('permissions pending')).toBeInTheDocument();

    expect(shown()).toEqual([]);
  });

  it('offers none of them after the permission read failed', async () => {
    servePermissions({ isStaff: true });
    server.use(
      http.get('*/pulp/api/v3/users/7/', () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderToolbar();

    await screen.findByText('zz.alpha');
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(screen.getByText('permissions pending')).toBeInTheDocument();
    expect(shown()).toEqual([]);
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
