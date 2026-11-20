import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import fileDescriptor from 'src/descriptors/file/descriptor';
import {
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
} from 'src/session/session-events';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { renderWithProviders } from 'src/test-utils/render';
import { type Lab, report, serveSyncLab } from 'src/test-utils/sync-lab';
import { SyncProgressPanel } from './progress-panel';

let intervals: IIntervals;
let account: { stop: () => void };

beforeEach(() => {
  intervals = trackIntervals();
  account = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  intervals.restore();
  account.stop();
  resetSessionEvents();
  vi.restoreAllMocks();
});

function renderPanel(lab: Lab) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <SyncProgressPanel
          repository={lab.repository}
          descriptor={fileDescriptor}
        />
      </PermissionsKnown>
    </AppContextProvider>,
  );
}

const pause = (ms = 60) => act(() => new Promise((r) => setTimeout(r, ms)));

describe(
  'Integration: the progress panel of a repository',
  { tags: ['integration'] },
  () => {
    it('draws nothing while the repository holds no task', async () => {
      const lab = serveSyncLab();
      const { container } = renderPanel(lab);

      await waitFor(() => expect(lab.lists.length).toBeGreaterThan(0));
      await pause();

      expect(container.querySelector('[data-cy="SyncProgress"]')).toBeNull();
    });

    it('shows each progress report with its message and done of total, and a count alone when the total is not known', async () => {
      const lab = serveSyncLab({
        tasks: [
          {
            state: 'running',
            progress_reports: [
              report('Downloading artifacts', 120, 300),
              report('Associating content', 7),
            ],
          },
        ],
      });
      renderPanel(lab);

      expect(await screen.findByText('Sync running')).toBeVisible();
      expect(screen.getByText('Downloading artifacts')).toBeVisible();
      expect(screen.getByText('120/300')).toBeVisible();
      const bar = screen.getByRole('progressbar', {
        name: 'Downloading artifacts',
      });
      expect(bar).toHaveAttribute('aria-valuenow', '120');
      expect(bar).toHaveAttribute('aria-valuemax', '300');
      expect(screen.getByText('Associating content')).toBeVisible();
      expect(screen.getByText('7 done')).toBeVisible();
      expect(screen.getAllByRole('progressbar')).toHaveLength(1);
    });

    it('says a task that has not started is queued', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'waiting' }] });
      renderPanel(lab);

      expect(await screen.findByText('Sync queued')).toBeVisible();
      expect(
        screen.getByText('Waiting for a worker to take the task.'),
      ).toBeVisible();
    });

    it('names a task that is not a sync by the task, and links to it', async () => {
      const lab = serveSyncLab({
        tasks: [
          { state: 'running', name: 'pulp_file.app.tasks.publishing.publish' },
        ],
      });
      renderPanel(lab);

      expect(await screen.findByText('File content publish')).toBeVisible();
      expect(
        screen.getByRole('link', { name: 'View the task' }),
      ).toHaveAttribute(
        'href',
        expect.stringMatching(/^\/tasks\/[0-9a-f-]{36}\/?$/),
      );
    });

    it('reads the task every two seconds past 300 seconds and stops at a final state, which stays on screen with the link to the task', async () => {
      const lab = serveSyncLab({
        tasks: [
          { state: 'running', progress_reports: [report('Fetching', 1, 10)] },
        ],
      });
      renderPanel(lab);
      await screen.findByText('Sync running');
      const task = lab.tasks[0];

      // 160 ticks of two seconds are 320 seconds of a task that does not end
      let reads = lab.details();
      for (let tick = 1; tick <= 160; tick++) {
        intervals.run(2000);
        await waitFor(() => expect(lab.details()).toBeGreaterThan(reads));
        reads = lab.details();
      }
      expect(screen.getByText('Sync running')).toBeVisible();

      lab.change(task.pulp_href, {
        state: 'completed',
        progress_reports: [report('Fetching', 10, 10, 'completed')],
      });
      intervals.run(2000);
      expect(await screen.findByText('Sync completed')).toBeVisible();
      expect(screen.getByText('10/10')).toBeVisible();
      expect(screen.getByRole('link', { name: 'View the task' })).toBeVisible();

      const after = lab.details();
      intervals.run(2000);
      await pause();
      expect(lab.details()).toBe(after);
      expect(screen.getByText('Sync completed')).toBeVisible();
    }, 60_000);

    it('reads again when the task ends so the rest of the page can show the end', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      renderPanel(lab);
      await screen.findByText('Sync running');
      const before = lab.lists.length;

      lab.change(lab.tasks[0].pulp_href, {
        state: 'failed',
        error: { description: 'The remote answered 500.' },
      });
      intervals.run(2000);

      expect(await screen.findByText('Sync failed')).toBeVisible();
      expect(screen.getByText('The remote answered 500.')).toBeVisible();
      await waitFor(() => expect(lab.lists.length).toBeGreaterThan(before));
    });

    it('follows a task that starts while the page is open, and shows the new one in place of the ended one', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      renderPanel(lab);
      await screen.findByText('Sync running');

      lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
      intervals.run(2000);
      await screen.findByText('Sync completed');

      lab.add({ state: 'waiting' });
      intervals.run(5000);

      expect(await screen.findByText('Sync queued')).toBeVisible();
      expect(screen.queryByText('Sync completed')).toBeNull();
    });

    it('stops reading and says why when the task is refused, and when it is gone', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      lab.failDetail(403);
      renderPanel(lab);

      expect(
        await screen.findByText('The progress of this task cannot be shown.'),
      ).toBeVisible();
      expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
      const reads = lab.details();
      intervals.run(2000);
      await pause();
      expect(lab.details()).toBe(reads);
    });

    it('says a task that is gone no longer exists', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      lab.failDetail(404);
      renderPanel(lab);

      expect(
        await screen.findByText('This task no longer exists.'),
      ).toBeVisible();
    });

    it('offers to read again when the first read of the task failed, and shows the task once it succeeds', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      lab.failDetail(500);
      const { user } = renderPanel(lab);

      await screen.findByText('The progress of this task cannot be shown.');
      lab.failDetail(null);
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      await waitFor(() =>
        expect(
          screen.queryByText('The progress of this task cannot be shown.'),
        ).toBeNull(),
      );
      expect(screen.getByText('Sync running')).toBeVisible();
    });

    it('asks for nothing while the sign-in dialog is open and reads again after signing in', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      renderPanel(lab);
      await screen.findByText('Sync running');

      setSignedIn(true);
      act(() => reportUnauthorized('request'));
      const before = lab.details();
      intervals.run(2000);
      await pause();
      expect(lab.details()).toBe(before);
      expect(screen.getByText('Sync running')).toBeVisible();
      expect(screen.queryByRole('alert')).toBeNull();

      act(() => resume());
      intervals.run(2000);
      await waitFor(() => expect(lab.details()).toBeGreaterThan(before));
    });

    it('sends no write', async () => {
      const lab = serveSyncLab({ tasks: [{ state: 'running' }] });
      renderPanel(lab);
      await screen.findByText('Sync running');
      intervals.run(2000);
      await pause();

      expect(lab.syncs).toEqual([]);
      expect(lab.cancels).toEqual([]);
      expect(within(document.body).queryByRole('dialog')).toBeNull();
    });
  },
);
