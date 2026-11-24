import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import debDescriptor from 'src/descriptors/deb/descriptor';
import fileDescriptor from 'src/descriptors/file/descriptor';
import rpmDescriptor from 'src/descriptors/rpm/descriptor';
import { type IIntervals, trackIntervals } from 'src/test-utils/intervals';
import { PUBLISH_TASK, servePublishLab } from 'src/test-utils/publish-lab';
import {
  distributionListHandler,
  pluginDistribution,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
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
    // The distributions and publications the dialog reads to find what is
    // pinned to an older publication: none, unless a test serves some.
    beforeEach(() => {
      server.use(
        distributionListHandler('file', []).handler,
        publicationListHandler('file', []).handler,
      );
    });

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

        expect(
          await screen.findByText('Publish of tools finished.'),
        ).toBeVisible();
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

        expect(
          await screen.findByText('Publish of tools failed.'),
        ).toBeVisible();
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
        expect(lab.publishes[0]).toEqual({
          repository_version: version.pulp_href,
        });
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

// The distributions of a plugin that serve a repository, answered as the
// server does, with the publications they are bound to.
function serveServing(
  plugin: 'file' | 'deb' | 'rpm',
  distributions: ReturnType<typeof pluginDistribution>[],
  publications: ReturnType<typeof pluginPublication>[],
) {
  server.use(
    distributionListHandler(plugin, distributions).handler,
    publicationListHandler(plugin, publications).handler,
  );
}

describe(
  'Integration: the options of the deb and rpm publish dialogs',
  { tags: ['integration'] },
  () => {
    const aptRepository = (overrides = {}) =>
      pluginRepository('deb', { name: 'apt-tools', ...overrides });
    const simpleSwitch = () =>
      screen.getByRole('switch', { name: /one release component/ });
    const structuredSwitch = () =>
      screen.getByRole('switch', {
        name: /release components and architectures/,
      });

    beforeEach(() => {
      serveServing('deb', [], []);
      serveServing('rpm', [], []);
    });

    it('starts the deb options at what the server uses and sends the repository alone', async () => {
      const lab = servePublishLab({
        repository: aptRepository(),
        segment: 'deb/apt',
      });
      const { user } = renderDialog(lab, { descriptor: debDescriptor });

      expect(simpleSwitch()).not.toBeChecked();
      expect(structuredSwitch()).toBeChecked();
      await user.click(publishButton());

      await waitFor(() => expect(lab.publishes).toHaveLength(1));
      expect(lab.publishes[0]).toEqual({
        repository: lab.repository.pulp_href,
      });
    });

    it('never lets both publishing modes be off, in either order', async () => {
      const lab = servePublishLab({
        repository: aptRepository(),
        segment: 'deb/apt',
      });
      const { user } = renderDialog(lab, { descriptor: debDescriptor });

      // structured off: simple is turned on, so one mode stays on
      await user.click(structuredSwitch());
      expect(structuredSwitch()).not.toBeChecked();
      expect(simpleSwitch()).toBeChecked();

      // simple off while structured is off: structured is turned back on
      await user.click(simpleSwitch());
      expect(simpleSwitch()).not.toBeChecked();
      expect(structuredSwitch()).toBeChecked();

      // simple on, then structured off leaves simple on
      await user.click(simpleSwitch());
      await user.click(structuredSwitch());
      expect(simpleSwitch()).toBeChecked();
      expect(structuredSwitch()).not.toBeChecked();
      await user.click(publishButton());

      await waitFor(() => expect(lab.publishes).toHaveLength(1));
      expect(lab.publishes[0]).toEqual({
        repository: lab.repository.pulp_href,
        simple: true,
        structured: false,
      });
    });

    it('offers the rpm checksum and compression types, from the repository, and sends the one that was changed', async () => {
      const lab = servePublishLab({
        repository: pluginRepository('rpm', {
          name: 'rpm-tools',
          checksum_type: 'sha256',
          compression_type: 'gz',
        }),
        segment: 'rpm/rpm',
        taskName: 'pulp_rpm.app.tasks.publishing.publish',
      });
      const { user } = renderDialog(lab, { descriptor: rpmDescriptor });

      expect(screen.getByLabelText('Checksum type')).toHaveValue('sha256');
      expect(screen.getByLabelText('Compression type')).toHaveValue('gz');
      await user.selectOptions(
        screen.getByLabelText('Compression type'),
        'zstd',
      );
      await user.click(publishButton());

      await waitFor(() => expect(lab.publishes).toHaveLength(1));
      expect(lab.publishes[0]).toEqual({
        repository: lab.repository.pulp_href,
        compression_type: 'zstd',
      });
    });

    it('leaves both rpm types to the server for a repository that sets none', async () => {
      const lab = servePublishLab({
        repository: pluginRepository('rpm', {
          name: 'rpm-tools',
          checksum_type: null,
          compression_type: null,
        }),
        segment: 'rpm/rpm',
        taskName: 'pulp_rpm.app.tasks.publishing.publish',
      });
      const { user } = renderDialog(lab, { descriptor: rpmDescriptor });

      expect(screen.getByLabelText('Checksum type')).toHaveValue('');
      expect(screen.getByLabelText('Compression type')).toHaveValue('');
      await user.click(publishButton());

      await waitFor(() => expect(lab.publishes).toHaveLength(1));
      expect(lab.publishes[0]).toEqual({
        repository: lab.repository.pulp_href,
      });
    });
  },
);

describe(
  'Integration: distributions pinned to an older publication',
  { tags: ['integration'] },
  () => {
    const repository = pluginRepository('file', { name: 'tools' });
    const version = (n: number) => `${repository.pulp_href}versions/${n}/`;
    const latest = { ...repository, latest_version_href: version(3) };
    const made = (n: number) =>
      pluginPublication('file', {
        repository: repository.pulp_href,
        repository_version: version(n),
      });
    const oldOne = made(1);
    const sameOne = made(3);
    const NEW = '/pulp/api/v3/publications/file/file/new-one/';

    const bound = (name: string, publication: string) =>
      pluginDistribution('file', { name, base_path: name, publication });

    const moves: { href: string; body: unknown }[] = [];

    // The change of what a distribution serves, answered as the server does:
    // a task, or a refusal for the distributions named as refused.
    function serveMoves(
      lab: ReturnType<typeof servePublishLab>,
      refused: string[] = [],
    ) {
      moves.length = 0;
      server.use(
        http.patch(
          `*${API}/distributions/file/file/:id/`,
          async ({ request }) => {
            const href = new URL(request.url).pathname;
            moves.push({ href, body: await request.json() });
            if (refused.includes(href)) {
              return HttpResponse.json(
                { publication: ['This publication cannot be served.'] },
                { status: 400 },
              );
            }
            const row = lab.add({ name: 'update', state: 'completed' });
            return HttpResponse.json({ task: row.pulp_href }, { status: 202 });
          },
        ),
      );
    }

    function serveBoth(distributions: ReturnType<typeof pluginDistribution>[]) {
      serveServing('file', distributions, [oldOne, sameOne]);
    }

    const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name });

    it('lists only what is bound to a publication of an older version, each unticked', async () => {
      const a = bound('zz-pinned-old', oldOne.pulp_href);
      serveBoth([
        a,
        bound('zz-pinned-same', sameOne.pulp_href),
        pluginDistribution('file', {
          name: 'zz-by-repository',
          base_path: 'zz-by-repository',
          repository: repository.pulp_href,
        }),
        pluginDistribution('file', {
          name: 'zz-by-version',
          base_path: 'zz-by-version',
          repository_version: version(1),
        }),
      ]);
      const lab = servePublishLab({ repository: latest });

      renderDialog(lab);

      expect(
        await screen.findByRole('checkbox', { name: /zz-pinned-old/ }),
      ).not.toBeChecked();
      expect(screen.getAllByRole('checkbox')).toHaveLength(1);
      expect(screen.queryByText(/zz-pinned-same/)).toBeNull();
      expect(screen.queryByText(/zz-by-repository/)).toBeNull();
      expect(screen.queryByText(/zz-by-version/)).toBeNull();
    });

    it('lists nothing and says nothing about moving when no distribution is pinned', async () => {
      serveBoth([bound('zz-pinned-same', sameOne.pulp_href)]);
      const lab = servePublishLab({ repository: latest });

      renderDialog(lab);

      await screen.findByText('Publish repository "tools"');
      await waitFor(() =>
        expect(screen.queryByText(/Looking for distributions/)).toBeNull(),
      );
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('sends no request to an unticked distribution, and closes at once when none is ticked', async () => {
      serveBoth([bound('zz-pinned-old', oldOne.pulp_href)]);
      const lab = servePublishLab({ repository: latest });
      serveMoves(lab);
      const onClose = vi.fn();
      const { user } = renderDialog(lab, { onClose });
      await screen.findByRole('checkbox', { name: /zz-pinned-old/ });

      await user.click(publishButton());

      await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
      expect(lab.publishes).toHaveLength(1);
      expect(moves).toEqual([]);
    });

    it('moves each ticked distribution once, after the task ended, and names the one that failed with the reason', async () => {
      const good = bound('zz-pinned-good', oldOne.pulp_href);
      const bad = bound('zz-pinned-bad', oldOne.pulp_href);
      const left = bound('zz-pinned-left', oldOne.pulp_href);
      serveBoth([good, bad, left]);
      const lab = servePublishLab({ repository: latest });
      lab.publishAs('completed', [NEW]);
      serveMoves(lab, [bad.pulp_href]);
      const onClose = vi.fn();
      const { user } = renderDialog(lab, { onClose });

      await user.click(
        await screen.findByRole('checkbox', { name: /zz-pinned-good/ }),
      );
      await user.click(checkbox(/zz-pinned-bad/));
      await user.click(publishButton());

      expect(
        await screen.findByText(/This publication cannot be served/),
      ).toBeVisible();
      expect(moves).toHaveLength(2);
      for (const { body } of moves) {
        expect(body).toEqual({
          publication: NEW,
          repository: null,
          repository_version: null,
        });
      }
      expect(moves.map(({ href }) => href).sort()).toEqual(
        [good.pulp_href, bad.pulp_href].sort(),
      );
      expect(moves.some(({ href }) => href === left.pulp_href)).toBe(false);
      const results = screen.getByRole('list', { name: 'Result of each move' });
      expect(within(results).getByText(/zz-pinned-good/)).toBeVisible();
      expect(within(results).getByText(/zz-pinned-bad/)).toBeVisible();
      // the dialog stays open to show the result
      expect(onClose).not.toHaveBeenCalled();
      expect(lab.publishes).toHaveLength(1);
    });

    it('moves nothing and says so when the publish failed', async () => {
      serveBoth([bound('zz-pinned-old', oldOne.pulp_href)]);
      const lab = servePublishLab({ repository: latest });
      lab.publishAs('failed');
      serveMoves(lab);
      const { user } = renderDialog(lab);

      await user.click(
        await screen.findByRole('checkbox', { name: /zz-pinned-old/ }),
      );
      await user.click(publishButton());

      expect(
        await screen.findByText(/No distribution was moved/),
      ).toBeVisible();
      expect(moves).toEqual([]);
    });
  },
);
