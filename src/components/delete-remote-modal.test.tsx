import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { task as taskBody } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { ansibleRemoteDeleteAction } from '../actions/ansible-remote-delete';
import { debRemoteDeleteAction } from '../actions/deb-remote-delete';
import { pythonRemoteDeleteAction } from '../actions/python-remote-delete';
import { rpmRemoteDeleteAction } from '../actions/rpm-remote-delete';
import type * as WaitForTask from '../utilities/wait-for-task';

// The polling of an unfinished task gives up after a few quick attempts, so a
// test about a task that never finishes does not wait minutes.
vi.mock('../utilities/wait-for-task', async (importOriginal) => {
  const original = await importOriginal<typeof WaitForTask>();
  return {
    ...original,
    waitForTaskUrl: (taskUrl, options = {}) =>
      original.waitForTaskUrl(taskUrl, {
        waitMs: 1,
        multiplier: 1,
        bailAfter: 2,
        ...options,
      }),
  };
});

const API = '/pulp/api/v3';
const REMOTE_ID = '00000000-0000-4000-8000-0000000000bb';
const REMOTE_NAME = 'zz-test-remote';
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
const TASK_URL = `*${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;

const PLUGINS = [
  {
    name: 'ansible',
    action: ansibleRemoteDeleteAction,
    path: 'remotes/ansible/collection',
  },
  { name: 'deb', action: debRemoteDeleteAction, path: 'remotes/deb/apt' },
  {
    name: 'python',
    action: pythonRemoteDeleteAction,
    path: 'remotes/python/python',
  },
  { name: 'rpm', action: rpmRemoteDeleteAction, path: 'remotes/rpm/rpm' },
];

interface Alert {
  title: ReactNode;
  variant?: string;
  description?: ReactNode;
}

// The page around the action: it holds the state the action's modal reads,
// keeps the alerts the action raises and renders them.
function Page({
  action,
  listQuery,
}: {
  action: (typeof PLUGINS)[number]['action'];
  listQuery: () => void;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [state, setState] = useState<Record<string, unknown>>({});
  const context = {
    addAlert: (alert: Alert) => setAlerts((all) => [...all, alert]),
    hasObjectPermission: () => true,
    hasPermission: () => true,
    listQuery,
    query: vi.fn(),
    reloadPage: vi.fn(),
    setState: (change: Record<string, unknown>) =>
      setState((current) => ({ ...current, ...change })),
    state,
  };
  return (
    <>
      <ul aria-label='alerts'>
        {alerts.map((alert, index) => (
          <li key={index} data-variant={alert.variant}>
            <b>{alert.title}</b> {alert.description}
          </li>
        ))}
      </ul>
      {action.button({ id: REMOTE_ID, name: REMOTE_NAME }, context)}
      {action.modal(context)}
    </>
  );
}

// Serves the delete of the remote and the polls of its task, and records the
// delete requests.
function setup(plugin: (typeof PLUGINS)[number]) {
  const listQuery = vi.fn();
  const deletes: string[] = [];
  const taskStates: object[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  server.use(
    http.delete(`*${API}/${plugin.path}/${REMOTE_ID}/`, async ({ request }) => {
      deletes.push(new URL(request.url).pathname);
      await gate;
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.get(TASK_URL, () => {
      const next = taskStates.shift() ?? taskBody({ pulp_href: TASK_HREF });
      return HttpResponse.json(next);
    }),
  );

  const view = renderWithProviders(
    <Page action={plugin.action} listQuery={listQuery} />,
  );

  return {
    deletes,
    listQuery,
    release,
    taskStates,
    ...view,
  };
}

// the alerts sit behind the dialog while it is open, so they are queried
// including hidden elements
const alertList = () =>
  screen.getByRole('list', { name: 'alerts', hidden: true });
const alerts = () => within(alertList());
const confirm = () =>
  within(screen.getByRole('dialog')).getByRole('button', { name: /^Delete/ });

async function openDialog(user) {
  await user.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('dialog');
}

describe.each(PLUGINS)('deleting a $name remote', (plugin) => {
  it('sends one delete however often Delete is pressed and keeps it disabled with a spinner until the answer', async () => {
    const { user, deletes, release } = setup(plugin);

    await openDialog(user);
    await user.click(confirm());
    await user.click(confirm());
    await user.click(confirm());

    await waitFor(() => expect(deletes).toHaveLength(1));
    expect(confirm()).toBeDisabled();
    expect(within(confirm()).getByRole('progressbar')).toBeTruthy();

    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(deletes).toHaveLength(1);
  });

  it('says the removal is still running, with the task link, when the wait ends before the task finished', async () => {
    const { user, listQuery, release, taskStates } = setup(plugin);
    for (let i = 0; i < 10; i++) {
      taskStates.push(taskBody({ pulp_href: TASK_HREF, state: 'running' }));
    }

    await openDialog(user);
    await user.click(confirm());
    release();

    await alerts().findByText(
      `The removal of remote ${REMOTE_NAME} is still running.`,
    );
    const link = alerts()
      .getAllByRole('link', { name: /detail page/, hidden: true })
      .at(-1);
    expect(link?.getAttribute('href')).toContain(
      '00000000-0000-4000-8000-0000000000aa',
    );
    expect(alerts().queryByText(/Failed to remove remote/)).toBeNull();
    expect(document.querySelector('li[data-variant="danger"]')).toBeNull();
    expect(listQuery).toHaveBeenCalledTimes(1);
  });

  it('says the outcome is unknown, with the task link, when the task status cannot be read', async () => {
    const { user, listQuery, release } = setup(plugin);
    server.use(
      http.get(TASK_URL, () =>
        HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
      ),
    );

    await openDialog(user);
    await user.click(confirm());
    release();

    await alerts().findByText(
      `The outcome of removing remote ${REMOTE_NAME} is unknown, because the task status could not be read. Check the task.`,
    );
    const link = alerts()
      .getAllByRole('link', { name: /detail page/, hidden: true })
      .at(-1);
    expect(link?.getAttribute('href')).toContain(
      '00000000-0000-4000-8000-0000000000aa',
    );
    expect(alerts().queryByText(/Failed to remove remote/)).toBeNull();
    expect(document.querySelector('li[data-variant="danger"]')).toBeNull();
    expect(listQuery).toHaveBeenCalledTimes(1);
  });

  it('still reports a task that failed as a failure and does not read the list again', async () => {
    const { user, listQuery, release, taskStates } = setup(plugin);
    taskStates.push(
      taskBody({
        pulp_href: TASK_HREF,
        state: 'failed',
        error: { description: 'The remote is in use by a test.' },
      }),
    );

    await openDialog(user);
    await user.click(confirm());
    release();

    await alerts().findByText(`Failed to remove remote ${REMOTE_NAME}`);
    expect(listQuery).not.toHaveBeenCalled();
  });
});
