import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  listOf,
  pythonDistribution,
  remote,
  task as taskBody,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import type * as WaitForTask from '../utilities/wait-for-task';
import { pythonDistributionEditAction } from './python-distribution-edit';

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
const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
const TASK_URL = `*${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
const DIST = pythonDistribution({ base_path: 'pypi-local' });

interface Alert {
  title: ReactNode;
  variant?: string;
  description?: ReactNode;
}

// The page around the dialog: it holds the state the action's modal reads,
// keeps the alerts the dialog raises and renders them.
function Page({ query }: { query: () => void }) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [state, setState] = useState<Record<string, unknown>>({
    pythonDistributionEditModal: {
      name: DIST.name,
      pulp_href: DIST.pulp_href,
    },
  });
  return (
    <>
      <ul aria-label='alerts'>
        {alerts.map((alert, index) => (
          <li key={index} data-variant={alert.variant}>
            <b>{alert.title}</b> {alert.description}
          </li>
        ))}
      </ul>
      {pythonDistributionEditAction.modal({
        addAlert: (alert: Alert) => setAlerts((all) => [...all, alert]),
        listQuery: vi.fn(),
        query,
        reloadPage: vi.fn(),
        setState: (change: Record<string, unknown>) =>
          setState((current) => ({ ...current, ...change })),
        state,
      })}
    </>
  );
}

// Serves the distribution, an empty list of remotes and an update that starts
// a task.
function setup() {
  const query = vi.fn();
  const taskStates: object[] = [];
  server.use(
    http.get(`*${DIST.pulp_href}`, () => HttpResponse.json(DIST)),
    listOf(`${API}/remotes/python/python/`, [remote({ name: 'mirror' })])
      .handler,
    http.patch(`*${DIST.pulp_href}`, () =>
      HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
    ),
    http.get(TASK_URL, () =>
      HttpResponse.json(
        taskStates.shift() ?? taskBody({ pulp_href: TASK_HREF }),
      ),
    ),
  );
  return { query, taskStates, ...renderWithProviders(<Page query={query} />) };
}

// the alerts sit behind the dialog while it is open
const alerts = () =>
  within(screen.getByRole('list', { name: 'alerts', hidden: true }));

async function saveAChange(user) {
  const uploads = await screen.findByRole('checkbox', {
    name: /Allow uploads/,
  });
  await waitFor(() => expect(uploads).toBeChecked());
  await user.click(uploads);
  await user.click(screen.getByRole('button', { name: /^Save/ }));
}

describe('saving the edit dialog of a Python distribution', () => {
  it('says the outcome is unknown, with the task link, when the task status cannot be read, and does not say it is still running', async () => {
    const { user, query } = setup();
    server.use(
      http.get(TASK_URL, () =>
        HttpResponse.json({ detail: 'bad gateway' }, { status: 502 }),
      ),
    );

    await saveAChange(user);

    await alerts().findByText(
      `The outcome of the update of distribution ${DIST.name} is unknown, because the task status could not be read. Check the task.`,
    );
    expect(alerts().queryByText(/is still running/)).toBeNull();
    const link = alerts()
      .getAllByRole('link', { name: /detail page/, hidden: true })
      .at(-1);
    expect(link?.getAttribute('href')).toContain(
      '00000000-0000-4000-8000-0000000000aa',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('says the update is still running, with the task link, when the wait ends before the task finished', async () => {
    const { user, query, taskStates } = setup();
    for (let i = 0; i < 10; i++) {
      taskStates.push(taskBody({ pulp_href: TASK_HREF, state: 'running' }));
    }

    await saveAChange(user);

    await alerts().findByText(
      `The update of distribution ${DIST.name} is still running.`,
    );
    expect(alerts().queryByText(/is unknown/)).toBeNull();
    const link = alerts()
      .getAllByRole('link', { name: /detail page/, hidden: true })
      .at(-1);
    expect(link?.getAttribute('href')).toContain(
      '00000000-0000-4000-8000-0000000000aa',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });
});
