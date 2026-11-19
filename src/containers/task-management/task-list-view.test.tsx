import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useNavigate } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { resetSessionEvents } from 'src/session/session-events';
import {
  serveMyPermissions,
  servePermissions,
} from 'src/test-utils/permissions';
import { listOf, taskPage, taskRow } from 'src/test-utils/pulp';
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

  it('shows the insufficient permissions page below the header, with the server reason and no alert, when the server answers 403', async () => {
    servePermissions();
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json(
          { detail: 'Not allowed.' },
          { status: 403, statusText: 'Forbidden' },
        ),
      ),
    );
    renderTasks();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('You do not have permission to view this page.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Go back' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Task management' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not allowed.');
    expect(screen.queryByText('Tasks list could not be displayed.')).toBeNull();
    expect(screen.queryByText(/Error 403/)).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Purge tasks' })).toBeNull();
  });

  it('shows the failure alert when the server answers 500', async () => {
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json(
          { detail: 'broken' },
          { status: 500, statusText: 'Internal Server Error' },
        ),
      ),
    );
    renderTasks();

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Insufficient permissions')).toBeNull();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});

function Navigate({ to }: { to: string }) {
  const navigate = useNavigate();
  return (
    <button type='button' onClick={() => navigate(to)}>
      {`go ${to}`}
    </button>
  );
}

describe('what the task list reads', () => {
  it('asks for the page, order and filters of the address', async () => {
    // the second page of five rows holds the sixth row and the ones after it
    const list = listOf(TASKS, [
      ...Array.from({ length: 5 }, (_, n) =>
        taskRow({ name: `zz.first-${n}` }),
      ),
      taskRow({ name: 'zz.alpha' }),
    ]);
    server.use(list.handler);
    renderWithProviders(
      <AppContextProvider>
        <TaskListView />
      </AppContextProvider>,
      {
        route:
          '/task-management?name__contains=alpha&state=running&page=2&page_size=5&sort=name',
      },
    );

    await screen.findByText('zz.alpha');

    expect(list.queries).toHaveLength(1);
    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '5',
      limit: '5',
      ordering: 'name',
      name__contains: 'alpha',
      state: 'running',
    });
  });

  it('lists ten rows, newest first, when the address names nothing', async () => {
    const list = listOf(TASKS, [taskRow({ name: 'zz.alpha' })]);
    server.use(list.handler);
    renderTasks();

    await screen.findByText('zz.alpha');

    expect(Object.fromEntries(list.queries[0])).toEqual({
      offset: '0',
      limit: '10',
      ordering: '-pulp_created',
    });
  });

  it('shows only the rows of the newest filter when an older answer arrives last', async () => {
    let releaseOlder: () => void = () => undefined;
    const older = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    server.use(
      http.get(`*${TASKS}`, async ({ request }) => {
        const filter = new URL(request.url).searchParams.get('name__contains');
        if (filter === null) {
          await older;
          return HttpResponse.json(taskPage([taskRow({ name: 'zz.older' })]));
        }
        return HttpResponse.json(taskPage([taskRow({ name: 'zz.newer' })]));
      }),
    );
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Navigate to='/task-management?name__contains=newer' />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );

    await user.click(
      screen.getByRole('button', {
        name: 'go /task-management?name__contains=newer',
      }),
    );
    expect(await screen.findByText('zz.newer')).toBeInTheDocument();
    releaseOlder();
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)));

    expect(screen.getByText('zz.newer')).toBeInTheDocument();
    expect(screen.queryByText('zz.older')).toBeNull();
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
    server.use(listOf(TASKS, [taskRow({ name: 'zz.alpha' })]).handler);
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

describe('the stop action of the task list', () => {
  afterEach(() => {
    resetSessionEvents();
    server.events.removeAllListeners();
  });

  const CHANGE = 'core.change_task';
  const running = taskRow({ name: 'zz.running', state: 'running' });
  const waiting = taskRow({ name: 'zz.waiting', state: 'waiting' });
  const done = taskRow({ name: 'zz.done', state: 'completed' });

  function Known() {
    const { permissionsReady } = useAppContext();
    return (
      <p>{permissionsReady ? 'permissions known' : 'permissions pending'}</p>
    );
  }

  function renderRows() {
    server.use(listOf(TASKS, [running, waiting, done]).handler);
    return renderWithProviders(
      <AppContextProvider>
        <Known />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );
  }

  const stops = () => screen.queryAllByRole('button', { name: 'Stop task' });
  const rowOf = (name: string) => screen.getByText(name).closest('tr');

  it('shows a viewer no Stop task and reads no task permissions while they are pending', async () => {
    servePermissions({ own: [['core.view_task']] });
    server.use(
      http.get('*/pulp/api/v3/users/7/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json({ id: 7, is_staff: false, groups: [] });
      }),
    );
    const { requests } = serveMyPermissions({});
    renderRows();

    await screen.findByText('zz.running');
    expect(screen.getByText('permissions pending')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(stops()).toHaveLength(0);
    expect(requests).toEqual([]);
  });

  it('shows a holder of the change permission Stop task on running and waiting rows only, reading nothing per task', async () => {
    servePermissions({ own: [[CHANGE]] });
    const { requests } = serveMyPermissions({});
    renderRows();

    await screen.findByText('zz.running');
    await screen.findByText('permissions known');

    expect(stops()).toHaveLength(2);
    expect(
      within(rowOf('zz.done')).queryByRole('button', { name: 'Stop task' }),
    ).toBeNull();
    expect(requests).toEqual([]);
  });

  it('shows Stop task on the rows whose own permissions list it, one read per running or waiting row', async () => {
    servePermissions({ own: [['core.view_task']] });
    const { requests } = serveMyPermissions({
      [running.pulp_href]: [CHANGE],
      [waiting.pulp_href]: ['core.view_task'],
    });
    renderRows();

    await screen.findByText('zz.running');
    await screen.findByText('permissions known');
    await waitFor(() => expect(requests).toHaveLength(2));

    await waitFor(() => expect(stops()).toHaveLength(1));
    expect(
      within(rowOf('zz.running')).getByRole('button', { name: 'Stop task' }),
    ).toBeInTheDocument();
    expect(
      within(rowOf('zz.waiting')).queryByRole('button', { name: 'Stop task' }),
    ).toBeNull();
    expect([...requests].sort()).toEqual(
      [
        `${running.pulp_href}my_permissions/`,
        `${waiting.pulp_href}my_permissions/`,
      ].sort(),
    );
  });

  it('names the button Stop task for assistive technology', async () => {
    servePermissions({ isStaff: true });
    renderRows();

    await screen.findByText('zz.running');

    expect(
      await screen.findAllByRole('button', { name: 'Stop task' }),
    ).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('shows the failure and the rows again when stopping fails, without a spinner', async () => {
    servePermissions({ isStaff: true });
    server.use(
      http.patch('*/pulp/api/v3/tasks/:id/', () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    const { user } = renderRows();

    await user.click(
      within(await waitForRow('zz.running')).getByRole('button', {
        name: 'Stop task',
      }),
    );
    await user.click(await screen.findByRole('button', { name: 'Yes, stop' }));

    expect(await screen.findByText(/could not be stopped/)).toBeInTheDocument();
    expect(await screen.findByText('zz.running')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

async function waitForRow(name: string) {
  const cell = await screen.findByText(name);
  await waitFor(() =>
    expect(
      within(cell.closest('tr')).queryByRole('button', { name: 'Stop task' }),
    ).not.toBeNull(),
  );
  return cell.closest('tr');
}

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
        names.map((name) => taskRow({ name })),
      ).handler,
    );

  function renderSignedIn() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management', signedIn: true },
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

describe('a task list read that fails', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  const broken = () =>
    http.get(`*${TASKS}`, () =>
      HttpResponse.json({ detail: 'broken' }, { status: 500 }),
    );

  it('offers Retry instead of saying there are no tasks, and lists after a fixed read', async () => {
    server.use(broken());
    const { user } = renderTasks();

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.queryByText('Tasks will appear once created.')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();

    server.use(listOf(TASKS, [taskRow({ name: 'zz.alpha' })]).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz.alpha')).toBeInTheDocument();
    expect(screen.queryByText('Tasks list could not be displayed.')).toBeNull();
  });

  it('shows a read answered in the wrong shape as a failed read', async () => {
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json({
          count: 1,
          next: null,
          previous: null,
          results: [{ name: 'zz.nameless-address', state: 'running' }],
        }),
      ),
    );
    renderTasks();

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No tasks yet')).toBeNull();
  });

  it('keeps the rows and adds one alert, no empty state, when a read of the same list fails', async () => {
    serveSignIn();
    server.use(listOf(TASKS, [taskRow({ name: 'zz.alpha' })]).handler);
    const { user } = renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management', signedIn: true },
    );
    await screen.findByText('zz.alpha');
    await signedIn();
    server.use(broken());

    await user.click(screen.getByRole('button', { name: 'Sign in again' }));

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.getByText('zz.alpha')).toBeInTheDocument();
    expect(
      screen.getAllByText('Tasks list could not be displayed.'),
    ).toHaveLength(1);
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.queryByText('Tasks will appear once created.')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows no rows of another filter when the read for the new filter fails', async () => {
    server.use(
      http.get(`*${TASKS}`, ({ request }) =>
        new URL(request.url).searchParams.has('name__contains')
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(taskPage([taskRow({ name: 'zz.unfiltered' })])),
      ),
    );
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Navigate to='/task-management?name__contains=beta' />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );
    await screen.findByText('zz.unfiltered');

    await user.click(
      screen.getByRole('button', {
        name: 'go /task-management?name__contains=beta',
      }),
    );

    expect(
      await screen.findByText('Tasks list could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('zz.unfiltered')).toBeNull();
    expect(screen.queryByText('No tasks yet')).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps the rows on screen while the next page of the same list loads', async () => {
    let releaseSecond: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    server.use(
      http.get(`*${TASKS}`, async ({ request }) => {
        const offset = new URL(request.url).searchParams.get('offset');
        if (offset === '10') {
          await second;
          return HttpResponse.json(
            taskPage([taskRow({ name: 'zz.page-two' })], { count: 11 }),
          );
        }
        return HttpResponse.json(
          taskPage([taskRow({ name: 'zz.page-one' })], { count: 11 }),
        );
      }),
    );
    const { user } = renderWithProviders(
      <AppContextProvider>
        <Navigate to='/task-management?page=2' />
        <TaskListView />
      </AppContextProvider>,
      { route: '/task-management' },
    );
    await screen.findByText('zz.page-one');

    await user.click(
      screen.getByRole('button', { name: 'go /task-management?page=2' }),
    );

    expect(screen.getByText('zz.page-one')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
    releaseSecond();
    expect(await screen.findByText('zz.page-two')).toBeInTheDocument();
    expect(screen.queryByText('zz.page-one')).toBeNull();
  });
});

describe('the writes of the task list', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  // Serves the list and records every read and every write, in order.
  function serveWith(
    write: { path: string; method: 'post' | 'patch'; status?: number },
    rows = [taskRow({ name: 'zz.running', state: 'running' })],
  ) {
    const calls: string[] = [];
    const bodies: unknown[] = [];
    server.use(
      http.get(`*${TASKS}`, () => {
        calls.push('GET list');
        return HttpResponse.json(taskPage(rows));
      }),
      http[write.method](`*${write.path}`, async ({ request }) => {
        calls.push(`${request.method} ${new URL(request.url).pathname}`);
        bodies.push(await request.json());
        return write.status && write.status >= 400
          ? HttpResponse.json({ detail: 'refused' }, { status: write.status })
          : write.method === 'patch'
            ? HttpResponse.json({ ...rows[0], state: 'canceling' })
            : HttpResponse.json(
                { task: '/pulp/api/v3/tasks/started/' },
                { status: 202 },
              );
      }),
    );
    return { calls, bodies, rows };
  }

  async function stopFirst(user) {
    await user.click(await screen.findByRole('button', { name: 'Stop task' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, stop' }));
  }

  it('stops a task with one PATCH to its address and reads the list once more', async () => {
    servePermissions({ isStaff: true });
    const rows = [taskRow({ name: 'zz.running', state: 'running' })];
    const { calls, bodies } = serveWith(
      { path: rows[0].pulp_href, method: 'patch' },
      rows,
    );
    const { user } = renderTasks();

    await stopFirst(user);

    expect(
      await screen.findByText('Task "zz.running" stopped successfully.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls).toEqual([
      'GET list',
      `PATCH ${rows[0].pulp_href}`,
      'GET list',
    ]);
    expect(bodies).toEqual([{ state: 'canceled' }]);
  });

  it('sends the stop once however often the confirm button is pressed', async () => {
    servePermissions({ isStaff: true });
    const rows = [taskRow({ name: 'zz.running', state: 'running' })];
    const { calls } = serveWith(
      { path: rows[0].pulp_href, method: 'patch' },
      rows,
    );
    const { user } = renderTasks();
    await user.click(await screen.findByRole('button', { name: 'Stop task' }));
    const confirm = await screen.findByRole('button', { name: 'Yes, stop' });

    await user.dblClick(confirm);

    await screen.findByText('Task "zz.running" stopped successfully.');
    expect(calls.filter((call) => call.startsWith('PATCH'))).toHaveLength(1);
  });

  it('shows the failure of a stop once and sends it once', async () => {
    servePermissions({ isStaff: true });
    const rows = [taskRow({ name: 'zz.running', state: 'running' })];
    const { calls } = serveWith(
      { path: rows[0].pulp_href, method: 'patch', status: 500 },
      rows,
    );
    const { user } = renderTasks();

    await stopFirst(user);

    expect(await screen.findByText(/could not be stopped/)).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(calls.filter((call) => call.startsWith('PATCH'))).toHaveLength(1);
    expect(screen.getByText('zz.running')).toBeInTheDocument();
  });

  const MAINTENANCE = [
    {
      button: 'Orphan cleanup',
      path: '/pulp/api/v3/orphans/cleanup/',
      started: 'Orphan cleanup started',
      failed: 'Orphan cleanup could not be started',
      body: { orphan_protection_time: 1440 },
    },
    {
      button: 'Repair',
      path: '/pulp/api/v3/repair/',
      started: 'Repair artifact storage started',
      failed: 'Repair artifact storage could not be started',
      body: { verify_checksums: true },
    },
    {
      button: 'Purge tasks',
      path: '/pulp/api/v3/tasks/purge/',
      started: 'Purge tasks started',
      failed: 'Purge tasks could not be started',
      body: { states: ['completed'] },
    },
  ];

  for (const action of MAINTENANCE) {
    it(`${action.button} sends one POST and reads the list again when it succeeds`, async () => {
      servePermissions({ isStaff: true });
      const { calls, bodies } = serveWith({
        path: action.path,
        method: 'post',
      });
      const { user } = renderTasks();
      await screen.findByText('zz.running');

      await user.click(
        await screen.findByRole('button', { name: action.button }),
      );
      await user.click(await screen.findByRole('button', { name: 'Yes' }));

      expect(await screen.findByText(action.started)).toBeInTheDocument();
      await waitFor(() => expect(calls).toHaveLength(3));
      expect(calls).toEqual(['GET list', `POST ${action.path}`, 'GET list']);
      expect(bodies[0]).toMatchObject(action.body);
    });

    it(`${action.button} shows its failure once, sends once and does not read the list again`, async () => {
      servePermissions({ isStaff: true });
      const { calls } = serveWith({
        path: action.path,
        method: 'post',
        status: 500,
      });
      const { user } = renderTasks();
      await screen.findByText('zz.running');

      await user.click(
        await screen.findByRole('button', { name: action.button }),
      );
      await user.click(await screen.findByRole('button', { name: 'Yes' }));

      expect(await screen.findByText(action.failed)).toBeInTheDocument();
      await act(() => new Promise((resolve) => setTimeout(resolve, 80)));
      expect(calls).toEqual(['GET list', `POST ${action.path}`]);
    });
  }
});
