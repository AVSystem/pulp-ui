import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { useLocation, useNavigate, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider, useAppContext } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { AlertList, type AlertType } from 'src/components';
import { fileRemote } from 'src/entities/file/remote';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  type IRemote,
  type IRepository,
  pluginListHandler,
  pluginRemote,
  task,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { WatchedTasksProvider } from '../watched-tasks';
import { type DeleteRemoteResult, useDeleteRemote } from './delete-remote';

const API = '/pulp/api/v3';
const TASK_ID = '5f1c3a0e-7d2b-4c1e-9a55-0c9d2e3f4a5b';
const TASK_HREF = `${API}/tasks/${TASK_ID}/`;

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

const MIRROR = pluginRemote('file', { name: 'mirror' });

// Serves the delete of a file remote and records what was sent. `answer` is
// the response of the DELETE; it may wait for something the test controls.
function serveDelete(
  answer: () => Response | Promise<Response> = () =>
    HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
) {
  const deletes: string[] = [];
  server.use(
    http.delete(`*${API}/remotes/file/file/:id/`, ({ request }) => {
      deletes.push(new URL(request.url).pathname);
      return answer();
    }),
  );
  return { deletes };
}

// A gate a test opens when the server should answer.
function gate() {
  let open: () => void = () => undefined;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

// The alerts queued for the next screen, as the application context holds them.
function Queued() {
  const { alerts } = useAppContext();

  return (
    <p data-testid='queued'>
      {alerts
        .map(({ title }) => (typeof title === 'string' ? title : '?'))
        .join('|')}
    </p>
  );
}

// A screen that asks for the delete of the remote and shows the result.
function Harness({
  onAccepted,
  alerts,
}: {
  onAccepted?: (alert: AlertType) => void;
  alerts?: AlertType[];
}) {
  const { remove, isPending } = useDeleteRemote({
    entity: fileRemote,
    plugin: 'file',
  });
  const [result, setResult] = useState<DeleteRemoteResult | null>(null);

  return (
    <>
      <button
        type='button'
        onClick={() => {
          void remove(MIRROR, {
            onAccepted: (alert) => {
              alerts?.push(alert);
              onAccepted?.(alert);
            },
          }).then(setResult);
        }}
      >
        Delete mirror
      </button>
      <p data-testid='pending'>{String(isPending)}</p>
      <p data-testid='status'>{result?.status ?? 'none'}</p>
      <p data-testid='uncertain'>
        {result?.status === 'failed' ? String(result.uncertain) : ''}
      </p>
      <div data-testid='failure'>
        {result?.status === 'failed' ? result.failure : null}
      </div>
      <Queued />
    </>
  );
}

function renderHarness(ui: ReactNode, options = {}) {
  return renderWithProviders(
    <AppContextProvider>
      <WatchedTasksProvider>{ui}</WatchedTasksProvider>
    </AppContextProvider>,
    { signedIn: true, ...options },
  );
}

let account: { stop: () => void };

beforeEach(() => {
  account = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  account.stop();
});

describe(
  'Integration: the remote delete helper',
  { tags: ['integration'] },
  () => {
    it('sends the delete once however often it is asked for before the server answers', async () => {
      const answered = gate();
      const { deletes } = serveDelete(async () => {
        await answered.opened;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const { user } = renderHarness(<Harness />);

      const button = screen.getByRole('button', { name: 'Delete mirror' });
      await user.click(button);
      await user.click(button);
      await user.click(button);

      await waitFor(() => expect(deletes).toHaveLength(1));
      expect(screen.getByTestId('pending')).toHaveTextContent('true');
      expect(deletes).toEqual([MIRROR.pulp_href]);

      answered.open();
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('accepted'),
      );
      expect(deletes).toHaveLength(1);
      expect(screen.getByTestId('pending')).toHaveTextContent('false');
    });

    it('hands the screen an alert with a link to the task once the server accepts the delete', async () => {
      serveDelete();
      const alerts: AlertType[] = [];
      const { user } = renderHarness(<Harness alerts={alerts} />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() => expect(alerts).toHaveLength(1));
      expect(alerts[0]?.variant).toBe('info');
      expect(alerts[0]?.title).toBe('Removal started for remote mirror');
      expect(screen.getByTestId('queued')).toHaveTextContent('');
    });

    it('queues the alert for the screen the user is on, and calls nobody back, when the user left before the server accepted it', async () => {
      const answered = gate();
      const { deletes } = serveDelete(async () => {
        await answered.opened;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const accepted: AlertType[] = [];

      function Screens() {
        const [shown, setShown] = useState(true);

        return (
          <>
            <button type='button' onClick={() => setShown(false)}>
              Leave
            </button>
            {shown ? <Harness onAccepted={(a) => accepted.push(a)} /> : null}
            <Queued />
          </>
        );
      }

      const { user } = renderHarness(<Screens />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));
      await waitFor(() => expect(deletes).toHaveLength(1));
      await user.click(screen.getByRole('button', { name: 'Leave' }));
      answered.open();

      await waitFor(() =>
        expect(screen.getAllByTestId('queued')[0]).toHaveTextContent(
          'Removal started for remote mirror',
        ),
      );
      expect(accepted).toEqual([]);
    });

    it('follows the task to its end at the application root', async () => {
      serveDelete();
      let reads = 0;
      server.use(
        http.get(`*${API}/tasks/:id/`, () => {
          reads += 1;
          return HttpResponse.json(task({ pulp_href: TASK_HREF }));
        }),
      );
      const { user } = renderHarness(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() => expect(reads).toBeGreaterThan(0));
    });

    it('releases the single-send guard and says the remote may be gone when a step after the accepted request throws', async () => {
      const { deletes } = serveDelete();
      const { user } = renderHarness(
        <Harness
          onAccepted={() => {
            throw new Error('The screen could not move.');
          }}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('failed'),
      );
      expect(screen.getByTestId('uncertain')).toHaveTextContent('true');
      expect(screen.getByTestId('failure')).toHaveTextContent(
        'The screen could not move.',
      );
      expect(screen.getByTestId('pending')).toHaveTextContent('false');

      // the button works again: a second press sends a second request
      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));
      await waitFor(() => expect(deletes).toHaveLength(2));
    });

    it('releases the guard when the request got no answer at all', async () => {
      let answers = 0;
      const { deletes } = serveDelete(() => {
        answers += 1;
        return answers === 1
          ? HttpResponse.error()
          : HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const { user } = renderHarness(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('failed'),
      );
      expect(screen.getByTestId('uncertain')).toHaveTextContent('true');
      expect(screen.getByTestId('pending')).toHaveTextContent('false');

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));
      await waitFor(() => expect(deletes).toHaveLength(2));
      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('accepted'),
      );
    });

    it('reports a refusal as the three-part description, certain that nothing was deleted, and releases the guard', async () => {
      const { deletes } = serveDelete(() =>
        HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      );
      const { user } = renderHarness(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('failed'),
      );
      expect(screen.getByTestId('uncertain')).toHaveTextContent('false');
      const failure = within(screen.getByTestId('failure'));
      expect(
        failure.getByText('You do not have permission to do this.'),
      ).toBeVisible();
      expect(failure.getByText('Not for you.')).toBeVisible();
      expect(
        failure.getByText(
          'Contact your organization administrator for more information.',
        ),
      ).toBeVisible();
      expect(screen.getByTestId('pending')).toHaveTextContent('false');

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));
      await waitFor(() => expect(deletes).toHaveLength(2));
    });

    it('reports nothing for a session that ended, and lets the delete be asked for again', async () => {
      let answers = 0;
      const { deletes } = serveDelete(() => {
        answers += 1;
        return answers === 1
          ? HttpResponse.json({ detail: 'Sign in.' }, { status: 401 })
          : HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const { user } = renderHarness(<Harness />);

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));

      await waitFor(() =>
        expect(screen.getByTestId('status')).toHaveTextContent('session-ended'),
      );
      expect(screen.getByTestId('failure')).toBeEmptyDOMElement();
      expect(screen.getByTestId('pending')).toHaveTextContent('false');

      await user.click(screen.getByRole('button', { name: 'Delete mirror' }));
      await waitFor(() => expect(deletes).toHaveLength(2));
    });

    it('answers busy and sends nothing while a delete is on its way', async () => {
      const answered = gate();
      const { deletes } = serveDelete(async () => {
        await answered.opened;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      const seen: string[] = [];

      function Twice() {
        const { remove } = useDeleteRemote({
          entity: fileRemote,
          plugin: 'file',
        });

        return (
          <button
            type='button'
            onClick={() => {
              void remove(MIRROR).then(({ status }) => seen.push(status));
              void remove(MIRROR).then(({ status }) => seen.push(status));
            }}
          >
            Delete twice
          </button>
        );
      }

      const { user } = renderHarness(<Twice />);

      await user.click(screen.getByRole('button', { name: 'Delete twice' }));
      await waitFor(() => expect(seen).toEqual(['busy']));
      answered.open();
      await waitFor(() => expect(seen).toEqual(['busy', 'accepted']));
      expect(deletes).toHaveLength(1);
    });
  },
);

// The remote detail is the screen that asks for the delete, in the application's
// own routes, next to a way to leave it.
function Routed() {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  return (
    <>
      <p data-testid='location'>{pathname}</p>
      <button
        type='button'
        onClick={() => navigate('/file/repositories/other/')}
      >
        Leave for another screen
      </button>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

function serveScreens(remotes: IRemote[], repositories: IRepository[] = []) {
  server.use(
    pluginListHandler('file', 'remote', remotes, { pageSize: 1000 }).handler,
    pluginListHandler('file', 'repository', repositories, { pageSize: 1000 })
      .handler,
  );
}

function Alerts() {
  const { alerts, setAlerts } = useAppContext();

  return <AlertList alerts={alerts} closeAlert={() => setAlerts([])} />;
}

function renderRoutes(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <WatchedTasksProvider>
        <PermissionsKnown>
          <Routed />
          <Alerts />
        </PermissionsKnown>
      </WatchedTasksProvider>
    </AppContextProvider>,
    { route, signedIn: true },
  );
}

describe(
  'Integration: the delete of a remote from its detail',
  { tags: ['integration'] },
  () => {
    it('moves to the remote list once the server accepts the delete', async () => {
      serveScreens([MIRROR]);
      const { deletes } = serveDelete();
      server.use(
        http.get(`*${API}/tasks/:id/`, () =>
          HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
        ),
      );
      const { user } = renderRoutes('/file/remotes/mirror/');

      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/file/remotes/',
        ),
      );
      expect(deletes).toEqual([MIRROR.pulp_href]);
    });

    it('does not move the user who left the detail before the server accepted the delete', async () => {
      serveScreens([MIRROR]);
      const answered = gate();
      const { deletes } = serveDelete(async () => {
        await answered.opened;
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      server.use(
        http.get(`*${API}/tasks/:id/`, () =>
          HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
        ),
      );
      const { user } = renderRoutes('/file/remotes/mirror/');

      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(deletes).toHaveLength(1));

      await user.click(
        screen.getByRole('button', { name: 'Leave for another screen' }),
      );
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/repositories/other/',
      );
      await act(async () => {
        answered.open();
        await new Promise((resolve) => setTimeout(resolve, 100));
      });

      expect(screen.getByTestId('location')).toHaveTextContent(
        '/file/repositories/other/',
      );
      // the result is queued for the screen the user is on
      expect(
        await screen.findByText('Removal started for remote mirror'),
      ).toBeVisible();
    });

    it('keeps the dialog open with the button working after an unexpected error', async () => {
      serveScreens([MIRROR]);
      let answers = 0;
      const { deletes } = serveDelete(() => {
        answers += 1;
        return answers === 1
          ? HttpResponse.error()
          : HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      });
      server.use(
        http.get(`*${API}/tasks/:id/`, () =>
          HttpResponse.json(task({ pulp_href: TASK_HREF, state: 'running' })),
        ),
      );
      const { user } = renderRoutes('/file/remotes/mirror/');

      await user.click(await screen.findByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(
        await within(dialog).findByText(/stopped with an unexpected error/),
      ).toBeVisible();
      const again = within(dialog).getByRole('button', { name: 'Delete' });
      expect(again).toBeEnabled();

      await user.click(again);
      await waitFor(() => expect(deletes).toHaveLength(2));
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/file/remotes/',
        ),
      );
    });
  },
);
