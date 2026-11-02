import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { type ComponentType, type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  listOf,
  repository,
  repositoryVersion,
  task as taskBody,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { RepositoryVersionsTab as FileTab } from '../containers/file-repository/tab-repository-versions';
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

const PLUGINS = [
  { name: 'file', path: 'repositories/file/file', Tab: FileTab },
];

const TASK_HREF = `${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;
const TASK_URL = `*${API}/tasks/00000000-0000-4000-8000-0000000000aa/`;

interface Alert {
  title: ReactNode;
  variant?: string;
  description?: ReactNode;
}

// The page around a tab: it keeps the alerts the tab raises and renders them,
// and counts how often the tab asks it to load the repository again.
function Page({
  Tab,
  item,
  reload,
}: {
  Tab: unknown;
  item: object;
  reload: () => void;
}) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const Versions = Tab as ComponentType<{
    item: object;
    actionContext: object;
  }>;
  return (
    <>
      <ul aria-label='alerts'>
        {alerts.map((alert, index) => (
          <li key={index} data-variant={alert.variant}>
            <b>{alert.title}</b> {alert.description}
          </li>
        ))}
      </ul>
      <Versions
        item={item}
        actionContext={{
          addAlert: (alert: Alert) => setAlerts((all) => [...all, alert]),
          hasObjectPermission: () => true,
          hasPermission: () => true,
          query: reload,
          state: { params: {} },
        }}
      />
    </>
  );
}

// Serves the versions of a repository (version 2 is the latest) and records
// the modify requests and the task polls.
function setup(plugin: (typeof PLUGINS)[number]) {
  const repo = repository({ name: 'zz-test-repo' });
  const first = repositoryVersion(repo, 1);
  const second = repositoryVersion(repo, 2);
  const item = { ...repo, latest_version_href: second.pulp_href };
  const reload = vi.fn();
  const modifies: { path: string; body: unknown }[] = [];
  const polls: { reloadsSoFar: number }[] = [];
  const taskStates: object[] = [];

  server.use(
    listOf(`${API}/${plugin.path}/:id/versions/`, [second, first]).handler,
    http.post(
      `*${API}/${plugin.path}/:id/modify/`,
      async ({ request, params }) => {
        modifies.push({
          path: new URL(request.url).pathname,
          body: await request.json(),
        });
        expect(params.id).toBe(repo.pulp_href.split('/').at(-2));
        return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
      },
    ),
    http.get(TASK_URL, () => {
      polls.push({ reloadsSoFar: reload.mock.calls.length });
      const next = taskStates.shift() ?? taskBody({ pulp_href: TASK_HREF });
      return HttpResponse.json(next);
    }),
  );

  const view = renderWithProviders(
    <Page Tab={plugin.Tab} item={item} reload={reload} />,
  );

  return { repo, first, second, reload, modifies, polls, taskStates, ...view };
}

const alerts = () => within(screen.getByRole('list', { name: 'alerts' }));

async function openRevert(user, versionNumber: string) {
  const link = await screen.findByRole('link', {
    name: new RegExp(`^${versionNumber}`),
  });
  const row = link.closest('tr') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'Actions' }));
}

async function confirmRevert(user) {
  await user.click(
    await screen.findByRole('menuitem', { name: /Revert to this version/ }),
  );
  await user.click(await screen.findByRole('button', { name: 'Revert' }));
}

describe.each(PLUGINS)(
  'reverting a $name repository to an earlier version',
  (plugin) => {
    it('asks for confirmation naming the version before anything is sent', async () => {
      const { user, modifies } = setup(plugin);

      await openRevert(user, '1');
      await user.click(
        await screen.findByRole('menuitem', { name: /Revert to this version/ }),
      );

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain('Are you sure you want to revert');
      expect(within(dialog).getByText('1').tagName).toBe('B');
      expect(modifies).toEqual([]);

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(modifies).toEqual([]);
    });

    it('posts the version as the base of a modify request, waits for the task and then reloads the page once', async () => {
      const { user, first, reload, modifies, polls, taskStates } =
        setup(plugin);
      taskStates.push(
        taskBody({ pulp_href: TASK_HREF, state: 'running' }),
        taskBody({ pulp_href: TASK_HREF, state: 'completed' }),
      );

      await openRevert(user, '1');
      await confirmRevert(user);

      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
      expect(modifies).toHaveLength(1);
      expect(modifies[0].path).toMatch(
        new RegExp(`${plugin.path}/[0-9a-f-]+/modify/$`),
      );
      expect(modifies[0].body).toEqual({ base_version: first.pulp_href });

      // the page was not reloaded before the task had completed
      expect(polls).toHaveLength(2);
      expect(polls.map((poll) => poll.reloadsSoFar)).toEqual([0, 0]);

      expect(alerts().getByText(/Revert started for repository/)).toBeTruthy();
      expect(alerts().queryByText(/Failed to revert/)).toBeNull();
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('shows the failure of the task and neither reports success nor reloads the page', async () => {
      const { user, reload, taskStates } = setup(plugin);
      taskStates.push(
        taskBody({
          pulp_href: TASK_HREF,
          state: 'failed',
          error: { description: 'The repository is locked by a test.' },
        }),
      );

      await openRevert(user, '1');
      await confirmRevert(user);

      await alerts().findByText(/Failed to revert repository/);
      expect(
        alerts().getByText(/The repository is locked by a test\./),
      ).toBeTruthy();
      expect(alerts().queryByText(/^Reverted repository/)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it('reports a task that is still running with its link and does not claim it failed', async () => {
      const { user, reload, taskStates } = setup(plugin);
      for (let i = 0; i < 10; i++) {
        taskStates.push(taskBody({ pulp_href: TASK_HREF, state: 'running' }));
      }

      await openRevert(user, '1');
      await confirmRevert(user);

      await alerts().findByText(/is still running/);
      const list = screen.getByRole('list', { name: 'alerts' });
      const link = within(list).getAllByRole('link', { name: /detail page/ });
      expect(link.at(-1)?.getAttribute('href')).toContain(
        '00000000-0000-4000-8000-0000000000aa',
      );
      expect(alerts().queryByText(/Failed to revert/)).toBeNull();
      expect(reload).not.toHaveBeenCalled();
    });

    it("shows the server's reason when the request is refused and closes the dialog", async () => {
      const { user, reload, polls, repo } = setup(plugin);
      server.use(
        http.post(`*${API}/${plugin.path}/:id/modify/`, () =>
          HttpResponse.json(
            { detail: 'You do not have permission to modify this.' },
            { status: 403 },
          ),
        ),
      );
      expect(repo.name).toBe('zz-test-repo');

      await openRevert(user, '1');
      await confirmRevert(user);

      await alerts().findByText(/Failed to revert repository/);
      expect(
        alerts().getByText(/You do not have permission to modify this\./),
      ).toBeTruthy();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(polls).toEqual([]);
      expect(reload).not.toHaveBeenCalled();
    });

    it('does not offer to revert to the current version', async () => {
      const { user, modifies } = setup(plugin);

      await openRevert(user, '2');

      const item = await screen.findByRole('menuitem', {
        name: /Revert to this version/,
      });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.textContent).toContain('Already the current version');

      await user.click(item);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(modifies).toEqual([]);
    });
  },
);
