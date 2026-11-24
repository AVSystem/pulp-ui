import { screen, waitFor } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fileDescriptor from 'src/descriptors/file/descriptor';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { PUBLISH_TASK, servePublishLab } from 'src/test-utils/publish-lab';
import { pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import {
  WATCH_POLL_MS,
  WatchedTasksProvider,
  useWatchedAnnouncements,
} from '../watched-tasks';
import { PublishDialog } from './publish-dialog';

const API = '/pulp/api/v3';

// What the application root says about the tasks it follows.
const Announcements = () => {
  const { alerts } = useWatchedAnnouncements();

  return (
    <ul>
      {alerts.map((alert) => (
        <li key={String(alert.title)}>{alert.title}</li>
      ))}
    </ul>
  );
};

const manifestBox = () => screen.getByLabelText('Manifest');
const sumsSelect = () => screen.getByLabelText('SHA256SUMS files');
const publishButton = () => screen.getByRole('button', { name: /^Publish$/ });

const tools = (overrides = {}) =>
  pluginRepository('file', {
    name: 'tools',
    manifest: 'INDEX',
    sha256sums: 'root',
    ...overrides,
  });

function renderDialog(
  lab: ReturnType<typeof servePublishLab>,
  props: Partial<Parameters<typeof PublishDialog>[0]> = {},
) {
  return renderWithProviders(
    <PublishDialog
      descriptor={fileDescriptor}
      repository={lab.repository}
      onClose={() => undefined}
      {...props}
    />,
  );
}

describe(
  'Integration: the publish dialog of the framework',
  { tags: ['integration'] },
  () => {
    describe('the latest version', () => {
      it('says what is published and starts with the options of the repository', () => {
        renderDialog(servePublishLab({ repository: tools() }));

        expect(screen.getByText('Publish repository "tools"')).toBeVisible();
        expect(manifestBox()).toHaveValue('INDEX');
        expect(sumsSelect()).toHaveValue('root');
      });

      it('falls back to what the server uses when the repository holds none', () => {
        renderDialog(
          servePublishLab({
            repository: tools({ manifest: null, sha256sums: null }),
          }),
        );

        expect(manifestBox()).toHaveValue('PULP_MANIFEST');
        expect(sumsSelect()).toHaveValue('disabled');
      });

      it('sends the repository alone when no option was changed, closes at once and reports the task', async () => {
        const lab = servePublishLab({ repository: tools() });
        const onClose = vi.fn();
        const onStarted = vi.fn();
        const { user } = renderDialog(lab, { onClose, onStarted });

        await user.click(publishButton());

        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
        expect(lab.publishes).toEqual([
          { repository: lab.repository.pulp_href },
        ]);
        expect(onStarted).toHaveBeenCalledWith(
          expect.stringMatching(/^\/pulp\/api\/v3\/tasks\/[0-9a-f-]{36}\/$/),
        );
        expect(lab.tasks[0]?.name).toBe(PUBLISH_TASK);
      });

      it('sends only the options that differ from what the repository holds', async () => {
        const lab = servePublishLab({ repository: tools() });
        const { user } = renderDialog(lab);

        await user.clear(manifestBox());
        await user.type(manifestBox(), 'LISTING');
        await user.click(publishButton());

        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        expect(lab.publishes[0]).toEqual({
          repository: lab.repository.pulp_href,
          manifest: 'LISTING',
        });
      });

      it('sends a changed choice', async () => {
        const lab = servePublishLab({ repository: tools() });
        const { user } = renderDialog(lab);

        await user.selectOptions(sumsSelect(), 'directory');
        await user.click(publishButton());

        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        expect(lab.publishes[0]).toEqual({
          repository: lab.repository.pulp_href,
          sha256sums: 'directory',
        });
      });

      it('sends one request however often Publish is pressed', async () => {
        const lab = servePublishLab({ repository: tools() });
        const { user } = renderDialog(lab);

        await user.dblClick(publishButton());
        await user.click(publishButton());

        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(lab.publishes).toHaveLength(1);
      });
    });

    describe('the end of the task', () => {
      let intervals: IIntervals;

      beforeEach(() => {
        intervals = trackIntervals();
      });
      afterEach(() => {
        intervals.restore();
      });

      it('is announced by the application root once the dialog is gone', async () => {
        const lab = servePublishLab({ repository: tools() });
        const { user } = renderWithProviders(
          <WatchedTasksProvider>
            <PublishDialog
              descriptor={fileDescriptor}
              repository={lab.repository}
              onClose={() => undefined}
            />
            <Announcements />
          </WatchedTasksProvider>,
        );

        await user.click(publishButton());
        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        lab.change(lab.tasks[0].pulp_href, { state: 'completed' });
        intervals.run(WATCH_POLL_MS);

        expect(await screen.findByText('Publish of tools finished.')).toBeVisible();
      });

      it('is announced as a failure when the task fails', async () => {
        const lab = servePublishLab({ repository: tools() });
        const { user } = renderWithProviders(
          <WatchedTasksProvider>
            <PublishDialog
              descriptor={fileDescriptor}
              repository={lab.repository}
              onClose={() => undefined}
            />
            <Announcements />
          </WatchedTasksProvider>,
        );

        await user.click(publishButton());
        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        lab.change(lab.tasks[0].pulp_href, { state: 'failed' });
        intervals.run(WATCH_POLL_MS);

        expect(await screen.findByText('Publish of tools failed.')).toBeVisible();
      });
    });

    describe('one version', () => {
      it('names the version and sends it instead of the repository', async () => {
        const lab = servePublishLab({ repository: tools() });
        const version = {
          number: 3,
          pulp_href: `${lab.repository.pulp_href}versions/3/`,
        };
        const { user } = renderDialog(lab, { version });

        expect(screen.getByText('Publish version 3 of "tools"')).toBeVisible();
        await user.click(publishButton());

        await waitFor(() => expect(lab.publishes).toHaveLength(1));
        expect(lab.publishes[0]).toEqual({ repository_version: version.pulp_href });
      });
    });

    describe('a publish that is refused', () => {
      it('stays open and says what the server said, for a repository without a version', async () => {
        const lab = servePublishLab({ repository: tools() });
        server.use(
          http.post(`*${API}/publications/file/file/`, () =>
            HttpResponse.json(
              {
                non_field_errors: [
                  'Repository has no version available to create Publication from',
                ],
              },
              { status: 400 },
            ),
          ),
        );
        const onClose = vi.fn();
        const { user } = renderDialog(lab, { onClose });

        await user.click(publishButton());

        expect(
          await screen.findByText('Failed to publish repository "tools"'),
        ).toBeVisible();
        expect(
          screen.getByText(/Repository has no version available/),
        ).toBeVisible();
        expect(onClose).not.toHaveBeenCalled();
        await waitFor(() => expect(publishButton()).toBeEnabled());
      });
    });
  },
);
