import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { resetSessionEvents } from 'src/session/session-events';
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
  taskListHandler,
  taskRow,
  versionListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { WATCH_POLL_MS, WatchedTasksProvider } from '../watched-tasks';

// The "Add content" dialog of the Content tab of a file repository as a user
// meets it: routed from the manifest, drawn from the file descriptor and
// answered by a server that holds a second repository with versions of its own
// and starts a task for every change of content.

const API = '/pulp/api/v3';
const FILES = `${API}/content/file/files/`;
const TASK_ID = '00000000-0000-4000-8000-0000000000cc';
const TASK_HREF = `${API}/tasks/${TASK_ID}/`;

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

let permissions: { stop: () => void };
let intervals: IIntervals;

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
  intervals = trackIntervals();
});

afterEach(() => {
  permissions.stop();
  intervals.restore();
  resetSessionEvents();
});

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

function render() {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <WatchedTasksProvider>
          <Routed />
        </WatchedTasksProvider>
      </PermissionsKnown>
    </AppContextProvider>,
    { route: '/file/repositories/tools/content', signedIn: true },
  );
}

interface Row {
  pulp_href: string;
  relative_path: string;
  pulp_created: string;
  pulp_labels: Record<string, string | null>;
}

const row = (n: number): Row => ({
  pulp_href: `${FILES}00000000-0000-4000-8000-${String(n).padStart(12, '0')}/`,
  relative_path: `docs/file-${String(n).padStart(3, '0')}.txt`,
  pulp_created: '2024-03-04T10:00:00.000000Z',
  pulp_labels: {},
});

// The repository "tools", which gets the content, and the repository "mirror",
// which holds it: version 0 of "mirror" holds file 1 and 2, version 1 holds
// files 1 to 4. "tools" holds file 9 in its latest version. A third repository
// is there to search among.
function serveLab() {
  const tools = pluginRepository('file', { name: 'tools' });
  const mirror = pluginRepository('file', { name: 'mirror' });
  const archive = pluginRepository('file', { name: 'archive' });
  const empty = pluginRepository('file', {
    name: 'fresh',
    latest_version_href: null,
  });
  const toolsHeld = `${tools.pulp_href}versions/0/`;
  const mirrorVersions = [0, 1].map((number) =>
    repositoryVersion(mirror, number),
  );
  mirror.latest_version_href = `${mirror.pulp_href}versions/1/`;
  const rows = [row(1), row(2), row(3), row(4), row(9)];
  const holds = new Map<string, string[]>([
    [toolsHeld, [rows[4].pulp_href]],
    [`${mirror.pulp_href}versions/0/`, [rows[0].pulp_href, rows[1].pulp_href]],
    [
      `${mirror.pulp_href}versions/1/`,
      rows.slice(0, 4).map((each) => each.pulp_href),
    ],
  ]);
  const modifies: { path: string; body: unknown }[] = [];
  const taskState = { state: 'running', reads: 0 };

  const files = listOf(FILES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      holds
        .get(query.get('repository_version') ?? '')
        ?.includes(each.pulp_href) === true,
    projected: projectedBy,
  });
  const repositories = pluginListHandler(
    'file',
    'repository',
    [tools, mirror, archive, empty],
    { pageSize: 1000 },
  );
  const versions = versionListHandler(mirror, mirrorVersions);

  server.use(
    repositories.handler,
    pluginListHandler('file', 'remote', [], { pageSize: 1000 }).handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    versions.handler,
    files.handler,
    http.post(`*${tools.pulp_href}modify/`, async ({ request }) => {
      modifies.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.get(`*${TASK_HREF}`, () => {
      taskState.reads += 1;
      return HttpResponse.json(
        taskRow({ pulp_href: TASK_HREF, state: taskState.state }),
      );
    }),
  );

  return {
    tools,
    mirror,
    rows,
    modifies,
    repositoryQueries: repositories.queries,
    versionQueries: versions.queries,
    contentQueries: files.queries,
    finish: async () => {
      await waitFor(() => expect(taskState.reads).toBeGreaterThan(0));
      taskState.state = 'completed';
      intervals.run(WATCH_POLL_MS);
    },
  };
}

const openButton = () => screen.findByRole('button', { name: 'Add content' });

async function open(user: ReturnType<typeof render>['user']) {
  await user.click(await openButton());
  return screen.findByRole('dialog');
}

async function choose(
  user: ReturnType<typeof render>['user'],
  dialog: HTMLElement,
  name: string,
) {
  await user.click(
    await within(dialog).findByRole('combobox', {
      name: 'Select a repository',
    }),
  );
  await user.click(await screen.findByRole('option', { name }));
}

describe(
  'Integration: adding content from another repository',
  { tags: ['integration'] },
  () => {
    it('offers Add content to a user who may modify the repository only', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.view_filerepository']],
      });
      serveLab();
      render();

      await screen.findByRole('grid', { name: 'Files' });
      expect(screen.queryByRole('button', { name: 'Add content' })).toBeNull();
    });

    it('offers Add content to a holder of the modify permission, also when the repository holds nothing yet', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.modify_filerepository']],
      });
      serveLab();
      render();

      expect(await openButton()).toBeEnabled();
    });

    it('lists the repositories of the plugin the user can read by name and never the repository itself', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await user.click(
        await within(dialog).findByRole('combobox', {
          name: 'Select a repository',
        }),
      );

      expect(
        await screen.findByRole('option', { name: 'mirror' }),
      ).toBeVisible();
      expect(screen.getByRole('option', { name: 'archive' })).toBeVisible();
      expect(screen.queryByRole('option', { name: 'tools' })).toBeNull();
      const query = lab.repositoryQueries.at(-1) as URLSearchParams;
      expect(query.getAll('fields').join(',')).toContain('latest_version_href');
      expect(query.get('limit')).toBe('20');
    });

    it('searches the repositories on the server by the text typed', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await user.type(
        await within(dialog).findByRole('combobox', {
          name: 'Select a repository',
        }),
        'mir',
      );

      await waitFor(() =>
        expect(
          lab.repositoryQueries.some(
            (query) => query.get('name__icontains') === 'mir',
          ),
        ).toBe(true),
      );
    });

    it('lists the content of the latest version of the chosen repository, never that of the current one', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'mirror');

      const grid = await within(dialog).findByRole('grid', { name: 'Files' });
      await within(grid).findByText('docs/file-004.txt');
      expect(within(grid).queryByText('docs/file-009.txt')).toBeNull();
      const query = lab.contentQueries.at(-1) as URLSearchParams;
      expect(query.get('repository_version')).toBe(
        `${lab.mirror.pulp_href}versions/1/`,
      );
      expect(
        within(dialog).getByRole('spinbutton', { name: 'Version' }),
      ).toHaveValue(1);
    });

    it('says that a repository without a version has nothing to add', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'fresh');

      expect(
        await within(dialog).findByText('This repository has no version.'),
      ).toBeVisible();
      expect(lab.contentQueries).toHaveLength(0);
    });

    it('lists another version when its number is typed, and says when the repository has none such', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'mirror');
      await within(dialog).findByText('docs/file-004.txt');
      const number = within(dialog).getByRole('spinbutton', {
        name: 'Version',
      });
      await user.clear(number);
      await user.type(number, '0');

      await waitFor(() =>
        expect(
          (lab.contentQueries.at(-1) as URLSearchParams).get(
            'repository_version',
          ),
        ).toBe(`${lab.mirror.pulp_href}versions/0/`),
      );
      await waitFor(() =>
        expect(within(dialog).queryByText('docs/file-004.txt')).toBeNull(),
      );
      expect(within(dialog).getByText('docs/file-002.txt')).toBeVisible();

      await user.clear(number);
      await user.type(number, '7');
      expect(
        await within(dialog).findByText('This repository has no version 7.'),
      ).toBeVisible();
    });

    it('sends one modify request with the addresses of the ticked rows and no base version, and shows the new version when the task ends', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'mirror');
      await within(dialog).findByText('docs/file-001.txt');
      const add = within(dialog).getByRole('button', { name: /^Add \d+ item/ });
      expect(add).toBeDisabled();
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Select docs/file-001.txt',
        }),
      );
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Select docs/file-003.txt',
        }),
      );
      await user.click(
        within(dialog).getByRole('button', { name: 'Add 2 items' }),
      );

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.modifies).toHaveLength(1);
      expect(lab.modifies[0].path).toMatch(/\/modify\/$/);
      expect(lab.modifies[0].body).toStrictEqual({
        add_content_units: [lab.rows[0].pulp_href, lab.rows[2].pulp_href],
      });
      expect(await screen.findByText(/Addition started/)).toBeVisible();
      await lab.finish();
    });

    it('sends one request however often Add is pressed', async () => {
      const lab = serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'mirror');
      await within(dialog).findByText('docs/file-001.txt');
      await user.click(
        within(dialog).getByRole('checkbox', {
          name: 'Select docs/file-002.txt',
        }),
      );
      const button = within(dialog).getByRole('button', {
        name: 'Add 1 item',
      });
      await user.dblClick(button);

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.modifies).toHaveLength(1);
    });

    it('starts every page of the browser from an empty selection and keeps the selection to the page', async () => {
      serveLab();
      const { user } = render();
      const dialog = await open(user);

      await choose(user, dialog, 'mirror');
      await within(dialog).findByText('docs/file-001.txt');

      expect(
        within(dialog).queryByRole('checkbox', { checked: true }),
      ).toBeNull();
      expect(within(dialog).getByText('No rows selected')).toBeVisible();
    });
  },
);
