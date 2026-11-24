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
  task,
  taskListHandler,
  versionSummaryHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';
import { WATCH_POLL_MS, WatchedTasksProvider } from '../watched-tasks';

// The Content tab of a file repository as a user meets it: routed from the
// manifest, drawn from the file descriptor and answered by a server that holds
// versions, cuts every row to the fields a request asks for and starts a task
// for every change of content.

const API = '/pulp/api/v3';
const FILES = `${API}/content/file/files/`;
const TASK_ID = '00000000-0000-4000-8000-0000000000bb';
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

function render(route = '/file/repositories/tools/content') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <WatchedTasksProvider>
          <Routed />
        </WatchedTasksProvider>
      </PermissionsKnown>
    </AppContextProvider>,
    { route, signedIn: true },
  );
}

interface Row {
  pulp_href: string;
  relative_path: string;
  pulp_created: string;
  pulp_labels: Record<string, string | null>;
  // a field the tab never asks for
  sha256: string;
}

const row = (n: number, overrides: Partial<Row> = {}): Row => ({
  pulp_href: `${FILES}00000000-0000-4000-8000-${String(n).padStart(12, '0')}/`,
  relative_path: `docs/file-${String(n).padStart(3, '0')}.txt`,
  pulp_created: '2024-03-04T10:00:00.000000Z',
  pulp_labels: {},
  sha256: 'a checksum the tab does not read',
  ...overrides,
});

// The file repository "tools" with versions 0 and 1; version 0 holds the rows
// of `before`, and a removal moves the repository to version 1, which holds the
// rows that are left. Every modify request is recorded with its body.
function serveLab({
  rows,
  removing = [],
  repositoryOverrides = {},
  answer = () => HttpResponse.json({ task: TASK_HREF }, { status: 202 }),
}: {
  rows: Row[];
  // the hrefs the new version no longer holds
  removing?: string[];
  repositoryOverrides?: Partial<ReturnType<typeof pluginRepository>>;
  answer?: () => Response | Promise<Response>;
}) {
  const repository = pluginRepository('file', {
    name: 'tools',
    ...repositoryOverrides,
  });
  const first = `${repository.pulp_href}versions/0/`;
  const second = `${repository.pulp_href}versions/1/`;
  const holds = new Map<string, Set<string>>([
    [first, new Set(rows.map((each) => each.pulp_href))],
    [
      second,
      new Set(
        rows
          .map((each) => each.pulp_href)
          .filter((href) => !removing.includes(href)),
      ),
    ],
  ]);
  const modifies: { path: string; body: unknown }[] = [];
  const taskState = { state: 'running' };

  const files = listOf(FILES, rows, {
    pageSize: 1000,
    matching: (each, query) =>
      holds.get(query.get('repository_version') ?? '')?.has(each.pulp_href) ===
      true,
    ordered: (selected, query) => {
      const ordering = query.get('ordering');
      if (!ordering) {
        return selected;
      }
      const field = ordering.replace(/^-/, '') as keyof Row;
      const sorted = [...selected].sort((a, b) =>
        String(a[field]).localeCompare(String(b[field])),
      );
      return ordering.startsWith('-') ? sorted.reverse() : sorted;
    },
    projected: projectedBy,
  });

  server.use(
    pluginListHandler('file', 'repository', [repository], { pageSize: 1000 })
      .handler,
    pluginListHandler('file', 'remote', [], { pageSize: 1000 }).handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    files.handler,
    http.post(`*${repository.pulp_href}modify/`, async ({ request }) => {
      modifies.push({
        path: new URL(request.url).pathname,
        body: await request.json(),
      });
      return answer();
    }),
    http.get(`*${TASK_HREF}`, () =>
      HttpResponse.json(task({ pulp_href: TASK_HREF, state: taskState.state })),
    ),
  );

  return {
    repository,
    first,
    second,
    modifies,
    queries: files.queries,
    // The task ends and the repository is on its new version.
    finish: () => {
      taskState.state = 'completed';
      repository.latest_version_href = second;
      intervals.run(WATCH_POLL_MS);
    },
  };
}

const table = () => screen.findByRole('grid', { name: 'Files' });
const bodyRows = (grid: HTMLElement) =>
  within(grid)
    .getAllByRole('row')
    .filter((each) => within(each).queryAllByRole('columnheader').length === 0);
const removeButton = () =>
  screen.findByRole('button', { name: 'Remove from repository' });

async function tick(
  user: ReturnType<typeof render>['user'],
  ...paths: string[]
) {
  for (const path of paths) {
    await user.click(
      await screen.findByRole('checkbox', { name: `Select ${path}` }),
    );
  }
}

describe(
  'Integration: the Content tab of a file repository',
  { tags: ['integration'] },
  () => {
    it('lists the files of the latest version with their path and creation time, and asks for the fields it shows', async () => {
      const lab = serveLab({ rows: [row(1), row(2), row(3)] });
      render();

      const grid = await table();
      await within(grid).findByText('docs/file-001.txt');

      const headers = within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.trim())
        .filter(Boolean);
      expect(headers).toEqual(['Relative path', 'Created']);
      expect(bodyRows(grid)).toHaveLength(3);
      const query = lab.queries[0] as URLSearchParams;
      expect(query.get('repository_version')).toBe(
        lab.repository.latest_version_href,
      );
      expect(query.get('ordering')).toBe('relative_path');
      expect(query.getAll('fields')).toContain('relative_path');
      expect(query.getAll('fields')).not.toContain('sha256');
      expect(
        screen.getByRole('tab', { name: 'Content', selected: true }),
      ).toBeVisible();
    });

    it('shows the empty state and sends no content request for a repository that has no version', async () => {
      const lab = serveLab({
        rows: [row(1)],
        repositoryOverrides: { latest_version_href: null },
      });
      render();

      expect(
        await screen.findByText('No files in the latest version'),
      ).toBeVisible();
      expect(lab.queries).toHaveLength(0);
    });

    it('offers check boxes to a user who may modify the repository only', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.view_filerepository']],
      });
      serveLab({ rows: [row(1), row(2)] });
      render();

      const grid = await table();
      await within(grid).findByText('docs/file-002.txt');

      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(
        screen.queryByRole('button', { name: 'Remove from repository' }),
      ).toBeNull();
    });

    it('offers check boxes to a user who holds the modify permission', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.modify_filerepository']],
      });
      serveLab({ rows: [row(1), row(2)] });
      render();

      const grid = await table();
      await within(grid).findByText('docs/file-002.txt');

      expect(within(grid).getAllByRole('checkbox')).toHaveLength(3);
      expect(await removeButton()).toBeDisabled();
    });

    it('starts every page from an empty selection', async () => {
      serveLab({
        rows: Array.from({ length: 45 }, (_, index) => row(index + 1)),
      });
      const { user } = render();

      const grid = await table();
      await within(grid).findByText('docs/file-001.txt');
      await tick(user, 'docs/file-001.txt', 'docs/file-002.txt');
      expect(await screen.findByText('2 rows selected')).toBeVisible();

      await user.click(
        screen.getAllByRole('button', {
          name: 'Go to next page',
        })[0] as HTMLElement,
      );
      await within(await table()).findByText('docs/file-021.txt');
      expect(screen.queryByText('2 rows selected')).toBeNull();
      expect(await removeButton()).toBeDisabled();

      await user.click(
        screen.getAllByRole('button', {
          name: 'Go to previous page',
        })[0] as HTMLElement,
      );
      await within(await table()).findByText('docs/file-001.txt');
      expect(screen.queryByText('2 rows selected')).toBeNull();
    });

    it('asks for confirmation naming the count and the files before anything is sent, and Cancel sends nothing', async () => {
      const lab = serveLab({ rows: [row(1), row(2), row(3), row(4)] });
      const { user } = render();

      await within(await table()).findByText('docs/file-001.txt');
      await tick(
        user,
        'docs/file-001.txt',
        'docs/file-002.txt',
        'docs/file-003.txt',
      );
      await user.click(await removeButton());

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(
        'Remove 3 items from repository "tools"?',
      );
      for (const path of [
        'docs/file-001.txt',
        'docs/file-002.txt',
        'docs/file-003.txt',
      ]) {
        expect(within(dialog).getByText(path)).toBeVisible();
      }
      expect(within(dialog).queryByText('docs/file-004.txt')).toBeNull();
      expect(lab.modifies).toEqual([]);

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.modifies).toEqual([]);
    });

    it('names at most ten files and counts the others', async () => {
      serveLab({
        rows: Array.from({ length: 14 }, (_, index) => row(index + 1)),
      });
      const { user } = render();

      const grid = await table();
      await within(grid).findByText('docs/file-001.txt');
      await user.click(
        screen.getByRole('checkbox', { name: 'Select all on this page' }),
      );
      await user.click(await removeButton());

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(
        'Remove 14 items from repository "tools"?',
      );
      expect(within(dialog).getAllByRole('listitem')).toHaveLength(10);
      expect(within(dialog).getByText('and 4 more')).toBeVisible();
    });

    it('sends one modify request without a base version for the removal of 3 rows and shows the new version once the task ends', async () => {
      const rows = [row(1), row(2), row(3), row(4), row(5)];
      const lab = serveLab({
        rows,
        removing: [rows[0].pulp_href, rows[1].pulp_href, rows[2].pulp_href],
      });
      const { user } = render();

      const grid = await table();
      await within(grid).findByText('docs/file-001.txt');
      await tick(
        user,
        'docs/file-001.txt',
        'docs/file-002.txt',
        'docs/file-003.txt',
      );
      await user.click(await removeButton());
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Remove',
        }),
      );

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.modifies).toHaveLength(1);
      expect(lab.modifies[0].path).toMatch(
        /\/repositories\/file\/file\/[^/]+\/modify\/$/,
      );
      expect(lab.modifies[0].body).toStrictEqual({
        remove_content_units: [
          rows[0].pulp_href,
          rows[1].pulp_href,
          rows[2].pulp_href,
        ],
      });
      expect(
        await screen.findByText('Removal started for repository "tools".'),
      ).toBeVisible();
      // the old version is on screen until the task has ended
      expect(screen.getByText('docs/file-001.txt')).toBeVisible();
      expect(screen.queryByText('2 rows selected')).toBeNull();

      lab.finish();

      await waitFor(() =>
        expect(screen.queryByText('docs/file-001.txt')).toBeNull(),
      );
      expect(screen.getByText('docs/file-004.txt')).toBeVisible();
      expect(bodyRows(await table())).toHaveLength(2);
      expect(
        lab.queries.some(
          (query) => query.get('repository_version') === lab.second,
        ),
      ).toBe(true);
    });

    it('sends one request however often Remove is pressed while the request is pending', async () => {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const lab = serveLab({
        rows: [row(1), row(2)],
        answer: async () => {
          await gate;
          return HttpResponse.json({ task: TASK_HREF }, { status: 202 });
        },
      });
      const { user } = render();

      await within(await table()).findByText('docs/file-001.txt');
      await tick(user, 'docs/file-001.txt');
      await user.click(await removeButton());
      const button = within(await screen.findByRole('dialog')).getByRole(
        'button',
        {
          name: 'Remove',
        },
      );
      await user.click(button);
      await user.click(button);

      await waitFor(() => expect(lab.modifies).toHaveLength(1));
      expect(button).toBeDisabled();
      release();
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.modifies).toHaveLength(1);
    });

    it('shows the three-part refusal and closes the dialog when the request is refused', async () => {
      const lab = serveLab({
        rows: [row(1), row(2)],
        answer: () =>
          HttpResponse.json({ detail: 'Not for you.' }, { status: 403 }),
      });
      const { user } = render();

      await within(await table()).findByText('docs/file-001.txt');
      await tick(user, 'docs/file-001.txt');
      await user.click(await removeButton());
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', {
          name: 'Remove',
        }),
      );

      expect(
        await screen.findByText(
          'Failed to remove content from repository "tools"',
        ),
      ).toBeVisible();
      expect(screen.getByText('Not for you.')).toBeVisible();
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(lab.modifies).toHaveLength(1);
    });
  },
);
