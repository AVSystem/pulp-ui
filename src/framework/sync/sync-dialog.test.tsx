import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fileDescriptor from 'src/descriptors/file/descriptor';
import { resetSessionEvents } from 'src/session/session-events';
import { answeredRequests } from 'src/test-utils/answered';
import { pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  SignInAgain,
  recordWrites,
  serveSignIn,
  signedIn,
} from 'src/test-utils/sign-in-again';
import {
  API,
  type Lab,
  SYNC_TASK,
  serveSyncLab,
} from 'src/test-utils/sync-lab';
import { SyncDialog } from './sync-dialog';

const mirrorSwitch = () =>
  screen.getByRole('switch', {
    name: /Content not present in remote repository/,
  });
const optimizeSwitch = () =>
  screen.getByRole('switch', { name: /Only perform the sync if changes/ });
const syncButton = () => screen.getByRole('button', { name: /^Sync/ });
const TASKS = `${API}/tasks/`;

function renderDialog(
  lab: Lab,
  props: Partial<Parameters<typeof SyncDialog>[0]> = {},
  options: { signedIn?: boolean } = {},
) {
  return renderWithProviders(
    <SyncDialog
      descriptor={fileDescriptor}
      repository={lab.repository}
      onClose={() => undefined}
      {...props}
    />,
    options,
  );
}

describe(
  'Integration: the sync dialog of the framework',
  { tags: ['integration'] },
  () => {
    describe('the options of the plugin', () => {
      it('starts with mirror on and optimize on, and sends them with the remote in one request, and closes at once', async () => {
        const lab = serveSyncLab();
        const onClose = vi.fn();
        const onStarted = vi.fn();
        const { user } = renderDialog(lab, { onClose, onStarted });

        expect(mirrorSwitch()).toBeChecked();
        expect(mirrorSwitch()).toBeEnabled();
        expect(optimizeSwitch()).toBeChecked();
        await user.click(syncButton());

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(lab.syncs).toEqual([
          {
            path: expect.stringMatching(
              /\/repositories\/file\/file\/[0-9a-f-]{36}\/sync\/$/,
            ),
            body: {
              remote: lab.repository.remote,
              mirror: true,
              optimize: true,
            },
          },
        ]);
        expect(onStarted).toHaveBeenCalledTimes(1);
        expect(onStarted).toHaveBeenCalledWith(
          expect.stringMatching(/^\/pulp\/api\/v3\/tasks\/[0-9a-f-]{36}\/$/),
        );
      });

      it('sends what the user chose', async () => {
        const lab = serveSyncLab();
        const { user } = renderDialog(lab);

        await user.click(mirrorSwitch());
        await user.click(optimizeSwitch());
        await user.click(syncButton());

        await waitFor(() => expect(lab.syncs).toHaveLength(1));
        expect(lab.syncs[0].body).toMatchObject({
          mirror: false,
          optimize: false,
        });
      });

      it('starts with mirror off, keeps it off and says why, for a repository that publishes by itself', async () => {
        const lab = serveSyncLab({
          repository: pluginRepository('file', {
            name: 'tools',
            autopublish: true,
            remote: `${API}/remotes/file/file/00000000-0000-4000-8000-000000000999/`,
          }),
        });
        const { user } = renderDialog(lab);

        expect(mirrorSwitch()).not.toBeChecked();
        expect(mirrorSwitch()).toBeDisabled();
        expect(
          screen.getByText(
            'Mirroring cannot be combined with autopublish, so this sync only adds missing content.',
          ),
        ).toBeVisible();

        await user.click(mirrorSwitch());
        await user.click(syncButton());

        await waitFor(() => expect(lab.syncs).toHaveLength(1));
        expect(lab.syncs[0].body).toMatchObject({ mirror: false });
      });

      it('shows no reason line when mirroring is allowed', () => {
        renderDialog(serveSyncLab());

        expect(screen.queryByText(/cannot be combined/)).toBeNull();
      });

      it('sends one request however often Sync is pressed', async () => {
        const lab = serveSyncLab();
        const { user } = renderDialog(lab);

        await user.dblClick(syncButton());
        await user.click(syncButton());

        await waitFor(() => expect(lab.syncs).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(lab.syncs).toHaveLength(1);
      });
    });

    describe('a sync that is refused', () => {
      const refuse = (status: number, body: unknown) =>
        server.use(
          http.post(`*${API}/repositories/file/file/:id/sync/`, () =>
            HttpResponse.json(body, { status }),
          ),
        );

      it('stays open with the options as they were, and says why in three parts for a refusal', async () => {
        const lab = serveSyncLab();
        refuse(403, {
          detail: 'You do not have permission to perform this action.',
        });
        const onClose = vi.fn();
        const { user } = renderDialog(lab, { onClose });

        await user.click(mirrorSwitch());
        await user.click(syncButton());

        expect(
          await screen.findByText('Failed to sync repository "tools"'),
        ).toBeVisible();
        expect(
          screen.getByText(/You do not have permission to perform this action/),
        ).toBeVisible();
        expect(onClose).not.toHaveBeenCalled();
        expect(mirrorSwitch()).not.toBeChecked();
        await waitFor(() => expect(syncButton()).toBeEnabled());
      });

      it('says what the server rejected', async () => {
        const lab = serveSyncLab();
        refuse(400, { remote: ['This field is required.'] });
        const { user } = renderDialog(lab);

        await user.click(syncButton());

        expect(
          await screen.findByText(/remote: This field is required/),
        ).toBeVisible();
      });

      it('shows no failure for the end of the session and keeps the dialog open', async () => {
        const lab = serveSyncLab();
        refuse(401, { detail: 'no' });
        const onClose = vi.fn();
        // a 401 to a user who is signed in is the end of the session; to a
        // visitor it is an ordinary failure
        const { user } = renderDialog(lab, { onClose }, { signedIn: true });

        await user.click(syncButton());
        await waitFor(() => expect(syncButton()).toBeEnabled());

        expect(screen.queryByText(/Failed to sync/)).toBeNull();
        expect(onClose).not.toHaveBeenCalled();
      });
    });

    describe('a sync already queued or running', () => {
      it('says a sync is already running, links the task and disables Sync, after one read of the repository tasks', async () => {
        const lab = serveSyncLab({
          tasks: [{ state: 'running', name: SYNC_TASK }],
        });
        renderDialog(lab);

        expect(
          await screen.findByText(
            'A sync of this repository is already running.',
          ),
        ).toBeVisible();
        expect(
          screen.getByRole('link', { name: 'View the task' }),
        ).toHaveAttribute(
          'href',
          expect.stringMatching(/^\/tasks\/[0-9a-f-]{36}\/?$/),
        );
        expect(syncButton()).toBeDisabled();
        expect(lab.lists).toHaveLength(1);
        expect(lab.lists[0].get('reserved_resources')).toBe(
          lab.repository.pulp_href,
        );
        expect(lab.lists[0].get('state__in')).toBe('waiting,running');
      });

      it('says a sync is queued when the task is still waiting', async () => {
        const lab = serveSyncLab({
          tasks: [{ state: 'waiting', name: SYNC_TASK }],
        });
        renderDialog(lab);

        expect(
          await screen.findByText(
            'A sync of this repository is already queued.',
          ),
        ).toBeVisible();
        expect(syncButton()).toBeDisabled();
      });

      it('names a task of another name and disables Sync', async () => {
        const lab = serveSyncLab({
          tasks: [
            {
              state: 'waiting',
              name: 'pulp_file.app.tasks.publishing.publish',
            },
          ],
        });
        renderDialog(lab);

        expect(
          await screen.findByText(
            'Another task is already queued for this repository: File content publish',
          ),
        ).toBeVisible();
        expect(syncButton()).toBeDisabled();
      });

      it('keeps Sync enabled and shows no warning when no task holds the repository', async () => {
        const lab = serveSyncLab();
        renderDialog(lab);

        await waitFor(() => expect(lab.lists).toHaveLength(1));
        expect(screen.queryByText(/already/)).toBeNull();
        expect(screen.queryByText(/Could not check/)).toBeNull();
        expect(syncButton()).toBeEnabled();
      });

      it('says the check failed and keeps Sync enabled when the task list cannot be read', async () => {
        const lab = serveSyncLab();
        server.use(
          http.get(`*${TASKS}`, () =>
            HttpResponse.json({ detail: 'broken' }, { status: 500 }),
          ),
        );
        renderDialog(lab);

        expect(
          await screen.findByText(
            /Could not check whether a sync is already running/,
          ),
        ).toBeVisible();
        expect(syncButton()).toBeEnabled();
      });
    });

    describe('after the same user signs in again', () => {
      afterEach(() => {
        resetSessionEvents();
      });

      // the open modal hides the rest of the page from the accessibility tree
      const signInAgain = (user) =>
        user.click(
          screen.getByRole('button', { name: 'Sign in again', hidden: true }),
        );
      const refusedTasks = () =>
        http.get(`*${TASKS}`, () =>
          HttpResponse.json({ detail: 'no' }, { status: 401 }),
        );

      function renderSignedIn(lab: Lab) {
        serveSignIn();
        return renderWithProviders(
          <>
            <SignInAgain />
            <SyncDialog
              descriptor={fileDescriptor}
              repository={lab.repository}
              onClose={() => undefined}
            />
          </>,
          { signedIn: true },
        );
      }

      it('checks again and enables Sync once the running sync has ended', async () => {
        const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
        const { user } = renderSignedIn(lab);
        await screen.findByText(
          'A sync of this repository is already running.',
        );
        await signedIn();
        lab.change(lab.tasks[0].pulp_href, { state: 'completed' });

        await signInAgain(user);

        await waitFor(() => expect(syncButton()).toBeEnabled());
        expect(screen.queryByText(/already/)).toBeNull();
      });

      it('keeps the running-sync notice and a disabled Sync when the check is refused with 401', async () => {
        const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
        const { user } = renderSignedIn(lab);
        await screen.findByText(
          'A sync of this repository is already running.',
        );
        await signedIn();
        server.use(refusedTasks());
        const refusals = answeredRequests(TASKS);

        await signInAgain(user);
        await refusals.untilAnswered();

        expect(
          screen.getByText('A sync of this repository is already running.'),
        ).toBeVisible();
        expect(syncButton()).toBeDisabled();
      });

      it('keeps Sync enabled and shows no error line when the first check is refused with 401', async () => {
        const lab = serveSyncLab();
        server.use(refusedTasks());
        const refusals = answeredRequests(TASKS);
        const { user } = renderSignedIn(lab);
        await signedIn();
        await refusals.untilAnswered();

        expect(syncButton()).toBeEnabled();
        expect(screen.queryByText(/Could not check/)).toBeNull();

        lab.add({ state: 'running' });
        server.use(
          http.get(`*${TASKS}`, () =>
            HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: lab.tasks,
            }),
          ),
        );
        await signInAgain(user);

        expect(
          await screen.findByText(
            'A sync of this repository is already running.',
          ),
        ).toBeVisible();
        expect(syncButton()).toBeDisabled();
      });

      it('keeps the chosen options and sends no write besides the sign-in', async () => {
        const lab = serveSyncLab();
        const recorded = recordWrites();
        const { user } = renderSignedIn(lab);
        await signedIn();
        await user.click(mirrorSwitch());
        expect(mirrorSwitch()).not.toBeChecked();
        const reads = answeredRequests(TASKS);

        await signInAgain(user);
        await reads.untilAnswered();

        expect(mirrorSwitch()).not.toBeChecked();
        expect(lab.syncs).toEqual([]);
        expect(recorded.writes).toEqual(['POST /pulp/api/v3/login/']);
        recorded.stop();
      });
    });
  },
);
