import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { Paths, formatPath } from 'src/paths';
import {
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
} from 'src/session/session-events';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import {
  serveMyPermissions,
  servePermissions,
} from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
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

function renderDetail(overrides: Partial<typeof task> = {}) {
  server.use(
    http.get('*/pulp/api/v3/tasks/:id/', () =>
      HttpResponse.json({ ...task, ...overrides }),
    ),
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

  it('lists the progress messages newest first and keeps that order when the page redraws', async () => {
    servePermissions({ isStaff: true });
    const { user } = renderDetail({ state: 'running' });
    const messages = () =>
      screen
        .getAllByText(/^Clean up orphan/)
        .map((element) => element.textContent);

    await screen.findByText('Reserve resources');
    const first = messages();
    expect(first).toEqual([
      'Clean up orphan Artifacts',
      'Clean up orphan Content',
    ]);

    // Opening the stop dialog redraws the page without loading the task
    // again.
    await user.click(await screen.findByRole('button', { name: 'Stop task' }));
    await screen.findByRole('dialog');

    expect(messages()).toEqual(first);
  });
});

describe('the stop action of the task detail', () => {
  afterEach(() => {
    server.events.removeAllListeners();
  });

  const CHANGE = 'core.change_task';

  function Known() {
    const { permissionsReady } = useAppContext();
    return (
      <p>{permissionsReady ? 'permissions known' : 'permissions pending'}</p>
    );
  }

  function renderWithKnown(overrides: Partial<typeof task> = {}) {
    server.use(
      http.get('*/pulp/api/v3/tasks/:id/', () =>
        HttpResponse.json({ ...task, ...overrides }),
      ),
    );
    return renderWithProviders(
      <AppContextProvider>
        <Known />
        <Routes>
          <Route path='/tasks/:task' element={<TaskDetail />} />
        </Routes>
      </AppContextProvider>,
      { route: '/tasks/0192e5a1-0000-7000-8000-000000000001' },
    );
  }

  const stop = () => screen.queryByRole('button', { name: 'Stop task' });

  it('shows a viewer no Stop task and reads no task permissions while they are pending', async () => {
    servePermissions({ own: [['core.view_task']] });
    server.use(
      http.get('*/pulp/api/v3/users/7/', async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
        return HttpResponse.json({ id: 7, is_staff: false, groups: [] });
      }),
    );
    const { requests } = serveMyPermissions({});
    renderWithKnown({ state: 'running' });

    await screen.findByText('Reserve resources');
    expect(screen.getByText('permissions pending')).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(stop()).toBeNull();
    expect(requests).toEqual([]);
  });

  it('shows a viewer no Stop task once the permissions are known', async () => {
    servePermissions({ own: [['core.view_task']] });
    serveMyPermissions({ [task.pulp_href]: ['core.view_task'] });
    renderWithKnown({ state: 'running' });

    await screen.findByText('Reserve resources');
    await screen.findByText('permissions known');
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)));

    expect(stop()).toBeNull();
  });

  it('shows a holder of the change permission Stop task on a running and a waiting task, reading nothing per task', async () => {
    servePermissions({ own: [[CHANGE]] });
    const { requests } = serveMyPermissions({});
    const first = renderWithKnown({ state: 'waiting' });

    expect(
      await screen.findByRole('button', { name: 'Stop task' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);
    first.unmount();

    renderWithKnown({ state: 'running' });
    expect(
      await screen.findByRole('button', { name: 'Stop task' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('shows no Stop task on a finished task whatever the account holds', async () => {
    servePermissions({ isStaff: true });
    renderWithKnown({ state: 'completed' });

    await screen.findByText('Reserve resources');
    await screen.findByText('permissions known');

    expect(stop()).toBeNull();
  });

  it('shows Stop task when only the task own permissions list the change permission, reading them once', async () => {
    servePermissions({ own: [['core.view_task']] });
    const { requests } = serveMyPermissions({ [task.pulp_href]: [CHANGE] });
    renderWithKnown({ state: 'running' });

    expect(
      await screen.findByRole('button', { name: 'Stop task' }),
    ).toBeInTheDocument();
    expect(requests).toEqual([`${task.pulp_href}my_permissions/`]);
  });

  it('names the page header button Stop task for assistive technology', async () => {
    servePermissions({ isStaff: true });
    renderWithKnown({ state: 'running' });

    const button = await screen.findByRole('button', { name: 'Stop task' });

    expect(within(button.closest('div')).getByText('Stop task')).toBeVisible();
    expect(button).not.toHaveAttribute('aria-label');
  });
});

describe('task detail reads that fail', () => {
  let intervals: IIntervals;
  beforeEach(() => {
    intervals = trackIntervals();
  });
  afterEach(() => {
    intervals.restore();
    resetSessionEvents();
    vi.restoreAllMocks();
  });

  const URL_PATH = '*/pulp/api/v3/tasks/:id/';
  const SECOND = '0192e5a1-0000-7000-8000-000000000002';
  const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));
  const answer = (status: number, detail = 'no') =>
    http.get(URL_PATH, () =>
      HttpResponse.json({ detail }, { status, statusText: 'Failed' }),
    );
  function Goto({ to }: { to: string }) {
    const navigate = useNavigate();
    return (
      <button type='button' onClick={() => navigate(to)}>
        go to {to}
      </button>
    );
  }

  function renderRoute() {
    return renderWithProviders(
      <AppContextProvider>
        <Goto to={`/tasks/${SECOND}`} />
        <Routes>
          <Route path='/tasks/:task' element={<TaskDetail />} />
        </Routes>
      </AppContextProvider>,
      { route: '/tasks/0192e5a1-0000-7000-8000-000000000001' },
    );
  }

  it('shows the insufficient permissions page with the header and the server reason when the first read is refused with 403', async () => {
    servePermissions();
    server.use(answer(403, 'Not allowed.'));
    renderRoute();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    expect(screen.getByText('Not allowed.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Not allowed.');
    expect(screen.getByRole('heading', { name: 'Task detail' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stop task' })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Page not found/)).toBeNull();
  });

  it('shows the not-found page only when the first read answers 404', async () => {
    server.use(answer(404, 'Not found.'));
    renderRoute();

    expect(await screen.findByText(/Page not found/)).toBeInTheDocument();
  });

  it('shows a retryable failure, not the not-found page, when the first read fails with 500', async () => {
    server.use(answer(500, 'broken'));
    const { user } = renderRoute();

    expect(
      await screen.findByText('Task could not be displayed.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Page not found/)).toBeNull();
    server.use(
      http.get(URL_PATH, () => HttpResponse.json({ ...task, state: 'failed' })),
    );

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Reserve resources')).toBeInTheDocument();
  });

  it('keeps the task on screen and adds one alert when a poll fails, and not a second while it is open', async () => {
    server.use(
      http.get(URL_PATH, () =>
        HttpResponse.json({
          ...task,
          state: 'running',
          progress_reports: [{ message: 'Step one', code: 'x', done: 1 }],
        }),
      ),
    );
    renderRoute();
    await screen.findByText('Step one');
    server.use(answer(502, 'bad gateway'));

    intervals.run(10000);
    expect(
      await screen.findAllByText('Task could not be displayed.'),
    ).toHaveLength(1);
    intervals.run(10000);
    await pause();

    expect(screen.getByText('Step one')).toBeInTheDocument();
    expect(screen.getAllByText('Task could not be displayed.')).toHaveLength(1);
    expect(screen.queryByText(/Page not found/)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('resets the shown task and polls the new one when the address moves from a finished task to a running one', async () => {
    server.use(
      http.get(URL_PATH, ({ params }) =>
        params.id === SECOND
          ? HttpResponse.json({
              ...task,
              pulp_href: `/pulp/api/v3/tasks/${SECOND}/`,
              state: 'running',
              progress_reports: [
                { message: 'Second task', code: 'x', done: 1 },
              ],
            })
          : HttpResponse.json({
              ...task,
              progress_reports: [{ message: 'First task', code: 'x', done: 1 }],
            }),
      ),
    );
    const { user } = renderRoute();
    await screen.findByText('First task');

    await user.click(
      screen.getByRole('button', { name: `go to /tasks/${SECOND}` }),
    );

    expect(await screen.findByText('Second task')).toBeInTheDocument();
    expect(screen.queryByText('First task')).toBeNull();
    // the running task is polled again
    server.use(
      http.get(URL_PATH, ({ params }) =>
        HttpResponse.json({
          ...task,
          pulp_href: `/pulp/api/v3/tasks/${params.id}/`,
          state: 'running',
          progress_reports: [
            { message: 'Second task, later', code: 'x', done: 2 },
          ],
        }),
      ),
    );
    intervals.run(10000);
    expect(await screen.findByText('Second task, later')).toBeInTheDocument();
  });
});

describe('task detail after the same user signs in again', () => {
  let intervals: IIntervals;
  beforeEach(() => {
    intervals = trackIntervals();
  });
  afterEach(() => {
    intervals.restore();
    resetSessionEvents();
    vi.restoreAllMocks();
  });

  const URL_PATH = '*/pulp/api/v3/tasks/:id/';
  const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));
  const signInAgain = (user) =>
    user.click(screen.getByRole('button', { name: 'Sign in again' }));
  const refused = http.get(URL_PATH, () =>
    HttpResponse.json({ detail: 'no' }, { status: 401 }),
  );
  const serve = (overrides: Partial<typeof task> = {}) => {
    const reads = { count: 0 };
    server.use(
      http.get(URL_PATH, () => {
        reads.count++;
        return HttpResponse.json({ ...task, ...overrides });
      }),
    );
    return reads;
  };
  const progress = (message: string) => ({
    progress_reports: [{ message, code: 'clean-up.content', done: 1 }],
  });

  function renderSignedIn() {
    serveSignIn();
    return renderWithProviders(
      <AppContextProvider>
        <SignInAgain />
        <Routes>
          <Route path='/tasks/:task' element={<TaskDetail />} />
        </Routes>
      </AppContextProvider>,
      { route: '/tasks/0192e5a1-0000-7000-8000-000000000001', signedIn: true },
    );
  }

  it('reads the task again and shows the fresh one', async () => {
    serve({ state: 'running', ...progress('Step one') });
    const { user } = renderSignedIn();
    await screen.findByText('Step one');
    await signedIn();
    serve({ state: 'running', ...progress('Step two') });

    await signInAgain(user);

    expect(await screen.findByText('Step two')).toBeInTheDocument();
  });

  it('keeps its content, with no alert and no not-found page, when the read is refused with 401', async () => {
    serve({ state: 'running', ...progress('Step one') });
    const { user } = renderSignedIn();
    await screen.findByText('Step one');
    await signedIn();
    server.use(refused);

    await signInAgain(user);
    await pause();

    expect(screen.getByText('Step one')).toBeInTheDocument();
    expect(screen.queryByText(/Page not found/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the spinner, with no not-found page, when the first read is refused, and shows the task after signing in', async () => {
    server.use(refused);
    const { user } = renderSignedIn();
    await signedIn();
    await pause();
    expect(screen.getByRole('progressbar')).toBeVisible();
    expect(screen.queryByText(/Page not found/)).toBeNull();
    serve({ state: 'running', ...progress('Step one') });

    await signInAgain(user);

    expect(await screen.findByText('Step one')).toBeInTheDocument();
  });

  it('still shows the not-found page when the task cannot be read for another reason', async () => {
    server.use(
      http.get(URL_PATH, () =>
        HttpResponse.json({ detail: 'gone' }, { status: 404 }),
      ),
    );
    renderSignedIn();

    expect(await screen.findByText(/Page not found/)).toBeInTheDocument();
  });

  describe('the poll of a running task', () => {
    it('asks for nothing while the sign-in dialog is open and reads again after signing in', async () => {
      const reads = serve({ state: 'running', ...progress('Step one') });
      renderSignedIn();
      await screen.findByText('Step one');
      await signedIn();

      setSignedIn(true);
      act(() => reportUnauthorized('request'));
      const before = reads.count;
      intervals.run(10000);
      await pause();
      expect(reads.count).toBe(before);

      act(() => resume());
      intervals.run(10000);
      await waitFor(() => expect(reads.count).toBeGreaterThan(before));
    });

    it('adds no alert when a poll is refused with 401', async () => {
      serve({ state: 'running', ...progress('Step one') });
      renderSignedIn();
      await screen.findByText('Step one');
      await signedIn();
      server.use(refused);

      intervals.run(10000);
      await pause();

      expect(screen.getByText('Step one')).toBeInTheDocument();
      expect(screen.queryByText(/Page not found/)).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    });
  });

  it('sends no write', async () => {
    serve({ state: 'running', ...progress('Step one') });
    const recorded = recordWrites();
    const { user } = renderSignedIn();
    await screen.findByText('Step one');
    await signedIn();

    await signInAgain(user);
    await pause();

    expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
    recorded.stop();
  });
});

describe('task detail on the data hooks', () => {
  let intervals: IIntervals;
  beforeEach(() => {
    intervals = trackIntervals();
  });
  afterEach(() => {
    intervals.restore();
    resetSessionEvents();
    vi.restoreAllMocks();
  });

  const ID = '0192e5a1-0000-7000-8000-000000000001';
  const URL_PATH = '*/pulp/api/v3/tasks/:id/';
  const pause = (ms = 80) => act(() => new Promise((r) => setTimeout(r, ms)));

  // Answers the task with the state the test sets, counting the reads.
  function serveTask(state: { value: string; error?: boolean }) {
    const reads = { count: 0 };
    server.use(
      http.get(URL_PATH, ({ params }) => {
        if (params.id !== ID) {
          return HttpResponse.json({ detail: 'Not found.' }, { status: 404 });
        }
        reads.count++;
        return HttpResponse.json({ ...task, state: state.value });
      }),
    );
    return reads;
  }

  function renderPage(route = `/tasks/${ID}`) {
    return renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route path='/tasks/:task' element={<TaskDetail />} />
        </Routes>
      </AppContextProvider>,
      { route },
    );
  }

  it('reads a running task every 10 seconds and stops once it has finished', async () => {
    const state = { value: 'running' };
    const reads = serveTask(state);
    renderPage();
    await screen.findByText('Reserve resources');
    expect(reads.count).toBe(1);

    intervals.run(10000);
    await waitFor(() => expect(reads.count).toBe(2));
    state.value = 'completed';
    intervals.run(10000);
    await waitFor(() => expect(reads.count).toBe(3));
    await screen.findByText('Completed');

    intervals.run(10000);
    intervals.run(10000);
    await pause();
    expect(reads.count).toBe(3);
  });

  it.each(['failed', 'canceled'])(
    'stops reading once the task is %s',
    async (final) => {
      const state = { value: 'running' };
      const reads = serveTask(state);
      renderPage();
      await screen.findByText('Reserve resources');

      state.value = final;
      intervals.run(10000);
      await waitFor(() => expect(reads.count).toBe(2));
      intervals.run(10000);
      await pause();

      expect(reads.count).toBe(2);
    },
  );

  it('shows the task when the first answer takes longer than the poll interval, with no second read started', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads = { started: 0 };
    server.use(
      http.get(URL_PATH, async () => {
        reads.started++;
        await gate;
        return HttpResponse.json({ ...task, state: 'running' });
      }),
    );
    renderPage();
    await waitFor(() => expect(reads.started).toBe(1));

    intervals.run(10000);
    intervals.run(10000);
    await pause();
    expect(reads.started).toBe(1);
    expect(screen.getByRole('progressbar')).toBeVisible();

    release();

    expect(await screen.findByText('Reserve resources')).toBeInTheDocument();
    expect(reads.started).toBe(1);
  });

  it('reads no domain, and every other resource and related task once across three poll rounds', async () => {
    const REPO = '0192e5a1-0000-7000-8000-0000000000a1';
    const FILE = '0192e5a1-0000-7000-8000-0000000000a2';
    const DOMAIN = '0192e5a1-0000-7000-8000-0000000000a3';
    const PARENT = '0192e5a1-0000-7000-8000-0000000000b1';
    const CHILD = '0192e5a1-0000-7000-8000-0000000000b2';
    const seen: string[] = [];
    server.use(
      http.get('*/pulp/api/v3/*', ({ request }) => {
        seen.push(new URL(request.url).pathname);
        return undefined;
      }),
      http.get(URL_PATH, ({ params }) => {
        if (params.id === ID) {
          return HttpResponse.json({
            ...task,
            state: 'running',
            parent_task: `/pulp/api/v3/tasks/${PARENT}/`,
            child_tasks: [`/pulp/api/v3/tasks/${CHILD}/`],
            reserved_resources_record: [
              `prn:core.domain:${DOMAIN}`,
              `prn:rpm.rpmrepository:${REPO}`,
              `shared:prn:file.filerepository:${FILE}`,
            ],
          });
        }
        return HttpResponse.json({
          ...task,
          pulp_href: `/pulp/api/v3/tasks/${params.id}/`,
          name: params.id === PARENT ? 'parent.task' : 'child.task',
        });
      }),
      http.get('*/pulp/api/v3/domains/:id/', () =>
        HttpResponse.json({ name: 'a-domain' }),
      ),
      http.get('*/pulp/api/v3/repositories/rpm/rpm/:id/', () =>
        HttpResponse.json({ name: 'rpm-repo' }),
      ),
      http.get('*/pulp/api/v3/repositories/file/file/:id/', () =>
        HttpResponse.json({ name: 'file-repo' }),
      ),
    );
    renderPage();

    expect(await screen.findByText('rpm-repo')).toBeInTheDocument();
    expect(await screen.findByText('file-repo')).toBeInTheDocument();
    expect(await screen.findByText('parent.task')).toBeInTheDocument();
    expect(await screen.findByText('child.task')).toBeInTheDocument();
    for (let round = 0; round < 3; round++) {
      intervals.run(10000);
      await pause();
    }

    const count = (needle: string) =>
      seen.filter((path) => path.includes(needle)).length;
    expect(count('/domains/')).toBe(0);
    expect(count(`/repositories/rpm/rpm/${REPO}/`)).toBe(1);
    expect(count(`/repositories/file/file/${FILE}/`)).toBe(1);
    expect(count(`/tasks/${PARENT}/`)).toBe(1);
    expect(count(`/tasks/${CHILD}/`)).toBe(1);
    expect(count(`/tasks/${ID}/`)).toBeGreaterThanOrEqual(4);
  });

  it('links the parent and the child tasks to their own detail', async () => {
    const PARENT = '0192e5a1-0000-7000-8000-0000000000b1';
    const CHILD = '0192e5a1-0000-7000-8000-0000000000b2';
    server.use(
      http.get(URL_PATH, ({ params }) =>
        HttpResponse.json({
          ...task,
          pulp_href: `/pulp/api/v3/tasks/${params.id}/`,
          name: params.id === PARENT ? 'parent.task' : 'child.task',
          ...(params.id === ID
            ? {
                parent_task: `/pulp/api/v3/tasks/${PARENT}/`,
                child_tasks: [`/pulp/api/v3/tasks/${CHILD}/`],
              }
            : {}),
        }),
      ),
    );
    renderPage();

    expect(
      await screen.findByRole('link', { name: 'parent.task' }),
    ).toHaveAttribute(
      'href',
      formatPath(Paths.core.task.detail, { task: PARENT }),
    );
    expect(screen.getByRole('link', { name: 'child.task' })).toHaveAttribute(
      'href',
      formatPath(Paths.core.task.detail, { task: CHILD }),
    );
  });

  it('shows not found without a request when the id in the address is not an id', async () => {
    const reads = serveTask({ value: 'running' });
    renderPage('/tasks/not-a-uuid');

    expect(await screen.findByText(/Page not found/)).toBeInTheDocument();
    await pause();
    expect(reads.count).toBe(0);
  });

  it('shows the insufficient permissions page for 403 and polls no more', async () => {
    servePermissions();
    let reads = 0;
    server.use(
      http.get(URL_PATH, () => {
        reads++;
        return HttpResponse.json({ detail: 'Not allowed.' }, { status: 403 });
      }),
    );
    renderPage();

    expect(
      await screen.findByText('Insufficient permissions'),
    ).toBeInTheDocument();
    intervals.run(10000);
    await pause();
    expect(reads).toBe(1);
  });

  it('shows a retryable failure for 500 with no polling until Retry is pressed', async () => {
    let reads = 0;
    server.use(
      http.get(URL_PATH, () => {
        reads++;
        return HttpResponse.json({ detail: 'broken' }, { status: 500 });
      }),
    );
    const { user } = renderPage();

    expect(
      await screen.findByText('Task could not be displayed.'),
    ).toBeInTheDocument();
    intervals.run(10000);
    intervals.run(10000);
    await pause();
    expect(reads).toBe(1);

    server.use(
      http.get(URL_PATH, () => {
        reads++;
        return HttpResponse.json({ ...task, state: 'running' });
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Reserve resources')).toBeInTheDocument();
    expect(reads).toBe(2);
    intervals.run(10000);
    await waitFor(() => expect(reads).toBe(3));
  });

  it('stops the task with one request and shows it canceled', async () => {
    servePermissions({ isStaff: true });
    const state = { value: 'running' };
    const reads = serveTask(state);
    const patches: unknown[] = [];
    server.use(
      http.patch(URL_PATH, async ({ request }) => {
        patches.push(await request.json());
        state.value = 'canceled';
        return HttpResponse.json({ ...task, state: 'canceled' });
      }),
    );
    const { user } = renderPage();

    await user.click(await screen.findByRole('button', { name: 'Stop task' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, stop' }));

    expect(await screen.findByText('Canceled')).toBeInTheDocument();
    expect(
      screen.getByText('Task "Orphan cleanup" stopped successfully.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop task' })).toBeNull();
    expect(patches).toEqual([{ state: 'canceled' }]);
    expect(reads.count).toBeGreaterThanOrEqual(2);
  });
});
