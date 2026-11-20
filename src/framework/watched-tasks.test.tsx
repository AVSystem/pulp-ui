import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import {
  type RouteObject,
  useLocation,
  useNavigate,
  useRoutes,
} from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { AlertList } from 'src/components';
import fileDescriptor from 'src/descriptors/file/descriptor';
import { taskUrlId } from 'src/entities/core/task/href';
import { taskKeys } from 'src/entities/core/task/queries';
import { entityKeys } from 'src/entities/plugin/queries';
import {
  reportUnauthorized,
  resetSessionEvents,
  resume,
} from 'src/session/session-events';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  distributionListHandler,
  listOf,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  repositoryVersion,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import { API, type Lab, serveSyncLab } from 'src/test-utils/sync-lab';
import { useUserContext } from 'src/user-context';
import { RevertVersionDialog } from './detail/revert-version';
import { PLUGIN_MANIFESTS, type PluginManifest } from './manifest';
import { frameworkRoutes } from './routes';
import {
  WATCHED_TASKS_STORAGE_KEY,
  WATCH_POLL_MS,
  type WatchedTask,
  WatchedTasksProvider,
  useWatchTask,
  useWatchedAnnouncements,
} from './watched-tasks';

const OWNER = '/pulp/api/v3/users/1/';
const REPOSITORY = `${API}/repositories/file/file/00000000-0000-4000-8000-000000000011/`;

let intervals: IIntervals;
let account: { stop: () => void };

beforeEach(() => {
  intervals = trackIntervals();
  account = servePermissions({ id: 1, isStaff: true });
});

afterEach(() => {
  intervals.restore();
  account.stop();
  resetSessionEvents();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

const pause = (ms = 60) => act(() => new Promise((r) => setTimeout(r, ms)));

const watching = (lab: Lab, label = 'Sync of repo-1'): WatchedTask => ({
  href: lab.tasks[0].pulp_href,
  label,
  resource: { app: 'file', object: 'repository', href: REPOSITORY },
});

// What a screen shows of the watcher: a button that registers each task, a
// way to leave the screen, a way to switch the account and the announcements
// in the alert list.
function Harness({ tasks }: { tasks: WatchedTask[] }) {
  const { watch } = useWatchTask();
  const { alerts, dismiss } = useWatchedAnnouncements();
  const navigate = useNavigate();
  const { setUser, endSession } = useUserContext();

  return (
    <>
      <p data-testid='location'>{useLocation().pathname}</p>
      <button type='button' onClick={() => endSession()}>
        End session
      </button>
      <SignInAgain />
      {tasks.map((task) => (
        <button key={task.href} type='button' onClick={() => watch(task)}>
          {`Watch ${task.label}`}
        </button>
      ))}
      <button type='button' onClick={() => navigate('/tasks')}>
        Go to tasks
      </button>
      <button
        type='button'
        onClick={() =>
          setUser({ username: 'other', pulp_href: '/pulp/api/v3/users/2/' })
        }
      >
        Other account
      </button>
      <AlertList alerts={alerts} closeAlert={dismiss} />
    </>
  );
}

function serveOtherAccount() {
  server.use(
    http.get('*/pulp/api/v3/users/2/roles/', () =>
      HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
    ),
    http.get('*/pulp/api/v3/users/2/', () =>
      HttpResponse.json({
        username: 'other',
        pulp_href: '/pulp/api/v3/users/2/',
        id: 2,
        is_staff: false,
        groups: [],
      }),
    ),
  );
}

function renderHarness(tasks: WatchedTask[]) {
  serveSignIn();
  return renderWithProviders(
    <WatchedTasksProvider>
      <Harness tasks={tasks} />
    </WatchedTasksProvider>,
    { signedIn: true },
  );
}

const watchButton = (label = 'Sync of repo-1') =>
  screen.getByRole('button', { name: `Watch ${label}` });

// Runs ticks of the polling interval, one awaited read each.
async function tick(lab: Lab, times = 1) {
  for (let i = 0; i < times; i++) {
    const before = lab.details();
    intervals.run(WATCH_POLL_MS);
    await waitFor(() => expect(lab.details()).toBeGreaterThan(before));
  }
}

const stored = () => window.sessionStorage.getItem(WATCHED_TASKS_STORAGE_KEY);

describe(
  'Integration: the tasks watched at the application root',
  { tags: ['integration'] },
  () => {
    it('keeps reading a watched task every five seconds wherever the user is and announces its end once, with a link to the task', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();

      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));
      await user.click(screen.getByRole('button', { name: 'Go to tasks' }));
      expect(screen.getByTestId('location')).toHaveTextContent('/tasks');

      await tick(lab, 2);
      expect(screen.queryByRole('link', { name: 'View the task' })).toBeNull();

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);
      expect(await screen.findByText('Sync of repo-1 finished.')).toBeVisible();

      const alert = screen
        .getByText('Sync of repo-1 finished.')
        .closest('.pf-v6-c-alert') as HTMLElement;
      const link = within(alert).getByRole('link', { name: 'View the task' });
      expect(link.getAttribute('href')).toMatch(
        new RegExp(`/tasks/${taskUrlId(lab.tasks[0].pulp_href)}/?$`),
      );
      expect(screen.getAllByText(/finished/)).toHaveLength(1);

      const reads = lab.details();
      intervals.run(WATCH_POLL_MS);
      await pause();
      expect(lab.details()).toBe(reads);
      expect(screen.getAllByText(/finished/)).toHaveLength(1);
    });

    it('says a failed task failed, in a danger alert, and a canceled one was canceled, in a warning', async () => {
      const lab = serveSyncLab({
        tasks: [{ state: 'running' }, { state: 'running' }],
      });
      const [second, first] = lab.tasks;
      const { user } = renderHarness([
        { href: first.pulp_href, label: 'Sync of repo-1' },
        { href: second.pulp_href, label: 'Revert of repo-2' },
      ]);
      await signedIn();
      await user.click(watchButton('Sync of repo-1'));
      await user.click(watchButton('Revert of repo-2'));
      await waitFor(() => expect(lab.details()).toBe(2));

      lab.change(first.pulp_href, { state: 'failed' });
      lab.change(second.pulp_href, { state: 'canceled' });
      intervals.run(WATCH_POLL_MS);

      const failed = (
        await screen.findByText('Sync of repo-1 failed.')
      ).closest('.pf-v6-c-alert');
      expect(failed).toHaveClass('pf-m-danger');
      const canceled = (
        await screen.findByText('Revert of repo-2 was canceled.')
      ).closest('.pf-v6-c-alert');
      expect(canceled).toHaveClass('pf-m-warning');
    });

    it('reads the repository, its versions and the task index again when the task ends, and nothing else of the plugin', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user, queryClient } = renderHarness([watching(lab)]);
      await signedIn();
      const repositories = entityKeys({ app: 'file', object: 'repository' });
      const keys = [
        repositories.byName('repo-1'),
        repositories.versions(REPOSITORY, {}),
        taskKeys.index,
        taskKeys.activeOf(REPOSITORY),
        ['pulp', 'file', 'remote', 'by-name', 'remote-1'],
      ];
      for (const key of keys) {
        queryClient.setQueryData(key, {});
      }
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));
      const invalidated = () =>
        keys.map((key) => queryClient.getQueryState(key)?.isInvalidated);
      expect(invalidated()).toEqual([false, false, false, false, false]);

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);
      await screen.findByText('Sync of repo-1 finished.');

      expect(invalidated()).toEqual([true, true, true, true, false]);
    });

    it('keeps reading past 300 seconds with no attempt limit, and stops at the end', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));

      // 64 ticks of five seconds are 320 seconds of a task that does not end
      await tick(lab, 64);
      expect(screen.queryByRole('link', { name: 'View the task' })).toBeNull();

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);
      expect(await screen.findByText('Sync of repo-1 finished.')).toBeVisible();
    }, 60_000);

    it.each([403, 404])(
      'drops a task whose read is answered with %i, with one info alert, and asks for it no more',
      async (status) => {
        const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
        const { user } = renderHarness([watching(lab)]);
        await signedIn();
        await user.click(watchButton());
        await waitFor(() => expect(lab.details()).toBe(1));

        lab.failDetail(status);
        intervals.run(WATCH_POLL_MS);

        const alert = (
          await screen.findByText(/Sync of repo-1 can no longer be followed/)
        ).closest('.pf-v6-c-alert');
        expect(alert).toHaveClass('pf-m-info');
        const reads = lab.details();
        intervals.run(WATCH_POLL_MS);
        await pause();
        expect(lab.details()).toBe(reads);
        expect(screen.getAllByText(/can no longer be followed/)).toHaveLength(
          1,
        );
        expect(stored()).toBeNull();
      },
    );

    it('drops a task whose first read failed for another reason with the same alert', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      lab.failDetail(500);
      const { user } = renderHarness([watching(lab)]);
      await signedIn();

      await user.click(watchButton());

      expect(
        await screen.findByText(/Sync of repo-1 can no longer be followed/),
      ).toBeVisible();
    });

    it('keeps a task whose later read fails with a server error and announces its end', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));

      lab.failDetail(500);
      await tick(lab);
      lab.failDetail(null);
      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);

      expect(await screen.findByText('Sync of repo-1 finished.')).toBeVisible();
      expect(screen.queryByText(/can no longer be followed/)).toBeNull();
    });

    it('asks for nothing while the sign-in dialog is open and goes on after the same account signs in', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));

      act(() => reportUnauthorized('request'));
      const before = lab.details();
      intervals.run(WATCH_POLL_MS);
      await pause();
      expect(lab.details()).toBe(before);
      expect(screen.queryByText(/can no longer be followed/)).toBeNull();

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      act(() => resume());
      intervals.run(WATCH_POLL_MS);

      expect(await screen.findByText('Sync of repo-1 finished.')).toBeVisible();
    });

    it('lets the user close an announcement', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'completed' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();

      await user.click(watchButton());
      await screen.findByText('Sync of repo-1 finished.');
      await user.click(screen.getByRole('button', { name: /close/i }));

      expect(screen.queryByText('Sync of repo-1 finished.')).toBeNull();
    });

    it('sends no write', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await tick(lab);

      expect(lab.syncs).toEqual([]);
      expect(lab.cancels).toEqual([]);
    });
  },
);

describe(
  'Integration: the watched tasks of one account',
  { tags: ['integration'] },
  () => {
    it('forgets the tasks, in memory and in storage, when another account signs in, and announces nothing to it', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      serveOtherAccount();
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));
      expect(stored()).not.toBeNull();

      await user.click(screen.getByRole('button', { name: 'Other account' }));
      await waitFor(() => expect(stored()).toBeNull());
      const reads = lab.details();
      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);
      await pause();

      expect(lab.details()).toBe(reads);
      expect(screen.queryByRole('link', { name: 'View the task' })).toBeNull();
    });

    it('forgets the tasks when the user signs out', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const { user } = renderHarness([watching(lab)]);
      await signedIn();
      await user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));

      await user.click(screen.getByRole('button', { name: 'End session' }));
      await waitFor(() => expect(stored()).toBeNull());
      const reads = lab.details();
      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);
      await pause();

      expect(lab.details()).toBe(reads);
      expect(screen.queryByRole('link', { name: 'View the task' })).toBeNull();
    });

    it('keeps the list of the same signed-in user over a reload of the tab and goes on watching', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const first = renderHarness([watching(lab)]);
      await signedIn();
      await first.user.click(watchButton());
      await waitFor(() => expect(lab.details()).toBe(1));
      expect(JSON.parse(stored() as string)).toEqual({
        owner: OWNER,
        tasks: [watching(lab)],
      });
      first.unmount();
      resetSessionEvents();
      const reads = lab.details();

      renderHarness([]);
      await signedIn();
      await waitFor(() => expect(lab.details()).toBeGreaterThan(reads));
      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);

      expect(await screen.findByText('Sync of repo-1 finished.')).toBeVisible();
      expect(stored()).toBeNull();
    });

    it('ignores and removes a list stored for another user', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      window.sessionStorage.setItem(
        WATCHED_TASKS_STORAGE_KEY,
        JSON.stringify({
          owner: '/pulp/api/v3/users/2/',
          tasks: [watching(lab)],
        }),
      );

      renderHarness([]);
      await signedIn();
      await waitFor(() => expect(stored()).toBeNull());
      intervals.run(WATCH_POLL_MS);
      await pause();

      expect(lab.details()).toBe(0);
    });

    it.each([
      ['text that is not JSON', 'not json'],
      ['a value of another shape', JSON.stringify(['a'])],
      ['an owner that is not a text', JSON.stringify({ owner: 5, tasks: [] })],
      ['tasks that are not a list', JSON.stringify({ owner: OWNER, tasks: 3 })],
    ])('ignores and removes %s', async (_name, value) => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      window.sessionStorage.setItem(WATCHED_TASKS_STORAGE_KEY, value);

      renderHarness([]);
      await signedIn();
      await waitFor(() => expect(stored()).toBeNull());
      await pause();

      expect(lab.details()).toBe(0);
    });

    it('keeps only the stored tasks whose address is that of a task of this server', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const good = watching(lab);
      window.sessionStorage.setItem(
        WATCHED_TASKS_STORAGE_KEY,
        JSON.stringify({
          owner: OWNER,
          tasks: [
            good,
            { href: `${API}/repositories/file/file/x/`, label: 'Not a task' },
            { href: 'https://elsewhere.example.com/tasks/x/', label: 'Away' },
            { href: '//elsewhere.example.com/tasks/x/', label: 'Away' },
            { href: good.href, label: 5 },
            'text',
          ],
        }),
      );

      renderHarness([]);
      await signedIn();
      await waitFor(() => expect(lab.details()).toBeGreaterThan(0));
      expect(JSON.parse(stored() as string).tasks).toEqual([good]);
    });
  },
);

// The framework screens under a router that also has a plain page to leave to,
// inside the root watcher and the app context.
const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

function Screens() {
  const navigate = useNavigate();
  const routes: RouteObject[] = [
    ...(guardRoutes(frameworkRoutes([FILE])) as RouteObject[]),
    { path: '/tasks', element: <h1>All tasks</h1> },
  ];
  const { alerts, dismiss } = useWatchedAnnouncements();

  return (
    <>
      <button type='button' onClick={() => navigate('/tasks')}>
        Go to tasks
      </button>
      <AlertList alerts={alerts} closeAlert={dismiss} />
      {useRoutes(routes)}
    </>
  );
}

describe(
  'Integration: a sync started on the repository page',
  { tags: ['integration'] },
  () => {
    const REMOTE = `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`;

    it('is announced on the task list once it ends there, with a link to the task', async () => {
      serveSignIn();
      const repository = pluginRepository('file', {
        name: 'tools',
        remote: REMOTE,
      });
      const lab = serveSyncLab({ repository });
      lab.startAs('running');
      server.use(
        pluginListHandler('file', 'repository', [repository]).handler,
        distributionListHandler('file', []).handler,
        publicationListHandler('file', []).handler,
        listOf(`${API}/remotes/`, [], {
          pageSize: 1000,
          projected: projectedBy,
        }).handler,
      );
      const { user } = renderWithProviders(
        <WatchedTasksProvider>
          <AppContextProvider>
            <PermissionsKnown>
              <Screens />
            </PermissionsKnown>
          </AppContextProvider>
        </WatchedTasksProvider>,
        { route: '/file/repositories/tools/', signedIn: true },
      );

      await user.click(await screen.findByRole('button', { name: 'Sync' }));
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Sync',
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.syncs).toHaveLength(1);

      await user.click(screen.getByRole('button', { name: 'Go to tasks' }));
      expect(
        await screen.findByRole('heading', { name: 'All tasks' }),
      ).toBeVisible();
      const task = lab.tasks[0];
      await waitFor(() => expect(lab.details()).toBeGreaterThan(0));

      lab.change(task.pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);

      expect(await screen.findByText('Sync of tools finished.')).toBeVisible();
      expect(screen.getAllByText(/Sync of tools finished/)).toHaveLength(1);
      const alert = screen
        .getByText('Sync of tools finished.')
        .closest('.pf-v6-c-alert') as HTMLElement;
      expect(
        within(alert)
          .getByRole('link', { name: 'View the task' })
          .getAttribute('href'),
      ).toMatch(new RegExp(`/tasks/${taskUrlId(task.pulp_href)}/?$`));
    });
  },
);

describe(
  'Integration: a revert started on the framework',
  { tags: ['integration'] },
  () => {
    it('is watched the same way and announced as a revert', async () => {
      serveSignIn();
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      const base = pluginRepository('file', { name: 'repo-1' });
      const version = repositoryVersion(base, 1);
      server.use(
        http.post(`*${base.pulp_href}modify/`, () =>
          HttpResponse.json({ task: lab.tasks[0].pulp_href }, { status: 202 }),
        ),
      );
      const onClose = vi.fn();
      const { user } = renderWithProviders(
        <WatchedTasksProvider>
          <AppContextProvider>
            <PermissionsKnown>
              <AlertsOnly />
              <RevertVersionDialog
                repository={base}
                version={version}
                entity={fileDescriptor.repository.entity}
                addAlert={() => undefined}
                onClose={onClose}
              />
            </PermissionsKnown>
          </AppContextProvider>
        </WatchedTasksProvider>,
        { signedIn: true },
      );

      await user.click(await screen.findByRole('button', { name: /^Revert/ }));
      await waitFor(() => expect(onClose).toHaveBeenCalled());
      await waitFor(() => expect(lab.details()).toBeGreaterThan(0));
      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(WATCH_POLL_MS);

      expect(
        await screen.findByText('Revert of repo-1 finished.'),
      ).toBeVisible();
    });
  },
);

function AlertsOnly() {
  const { alerts, dismiss } = useWatchedAnnouncements();
  return <AlertList alerts={alerts} closeAlert={dismiss} />;
}
