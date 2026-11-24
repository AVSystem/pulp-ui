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
  distribution,
  distributionListHandler,
  listOf,
  pluginListHandler,
  pluginRepository,
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

// Deleting a repository version from the Versions tab and from the version's
// own page, as a user meets it: the versions the server would refuse are
// disabled with the reason before anything is sent, and a refusal the server
// gives anyway is shown as it was written.

const API = '/pulp/api/v3';
const TASK_ID = '00000000-0000-4000-8000-0000000000dd';
const TASK_HREF = `${API}/tasks/${TASK_ID}/`;
const REFUSAL =
  'The repository version cannot be deleted because it (or its publications) are currently being used to distribute content. Please update the necessary distributions first.';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

const DELETE = 'file.delete_filerepository';
const VIEW_PUBLICATIONS = 'file.view_filepublication';

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

function render(route = '/file/repositories/tools/versions') {
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

type Distribution = ReturnType<typeof distribution>;

interface Publication {
  pulp_href: string;
  repository: string;
  repository_version: string;
  pulp_created: string;
}

// The repository "tools" with the versions 0 to count - 1, the last the
// latest, the distributions given and the publications of the numbers given.
// Every delete request is recorded; a refusal answers 400 with the server's
// text.
function serveLab({
  count = 4,
  bind = () => [],
  published = [],
  refuse = false,
}: {
  count?: number;
  // the distributions, given the repository's and its version addresses
  bind?: (
    repository: string,
    versionOf: (number: number) => string,
    publicationOf: (number: number) => string,
  ) => Partial<Distribution & { name: string }>[];
  published?: number[];
  refuse?: boolean;
} = {}) {
  const base = pluginRepository('file', { name: 'tools' });
  const versions = Array.from({ length: count }, (_, number) =>
    repositoryVersion(base, number, {
      pulp_created: `2024-01-${String(number + 1).padStart(2, '0')}T10:00:00.000000Z`,
    }),
  );
  const repository = {
    ...base,
    latest_version_href: versions[versions.length - 1].pulp_href,
  };
  const versionOf = (number: number) =>
    `${repository.pulp_href}versions/${number}/`;
  const publicationOf = (number: number) =>
    `${API}/publications/file/file/00000000-0000-4000-8000-0000000009${String(number).padStart(2, '0')}/`;
  const publications: Publication[] = published.map((number) => ({
    pulp_href: publicationOf(number),
    repository: repository.pulp_href,
    repository_version: versionOf(number),
    pulp_created: `2024-02-${String(number + 1).padStart(2, '0')}T10:00:00.000000Z`,
  }));
  const distributions = bind(
    repository.pulp_href,
    versionOf,
    publicationOf,
  ).map((overrides) => distribution(overrides));
  const deletes: string[] = [];
  const taskState = { state: 'running', reads: 0 };
  const list = versionListHandler(repository, versions);

  server.use(
    pluginListHandler('file', 'repository', [repository], { pageSize: 1000 })
      .handler,
    pluginListHandler('file', 'remote', [], { pageSize: 1000 }).handler,
    list.handler,
    distributionListHandler('file', distributions).handler,
    publicationListHandler('file', publications).handler,
    listOf(`${API}/content/file/files/`, []).handler,
    listOf(`${API}/content/`, []).handler,
    versionSummaryHandler({ patched: true, versions: [] }).handler,
    taskListHandler([]).handler,
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
    http.delete(`*${repository.pulp_href}versions/:number/`, ({ params }) => {
      deletes.push(`${repository.pulp_href}versions/${params.number}/`);
      return refuse
        ? HttpResponse.json([REFUSAL], { status: 400 })
        : HttpResponse.json({ task: TASK_HREF }, { status: 202 });
    }),
    http.get(`*${TASK_HREF}`, () => {
      taskState.reads += 1;
      return HttpResponse.json(
        taskRow({ pulp_href: TASK_HREF, state: taskState.state }),
      );
    }),
  );

  return {
    repository,
    versions,
    deletes,
    versionQueries: list.queries,
    // The task ends and the version is gone.
    finish: async (number: number) => {
      await waitFor(() => expect(taskState.reads).toBeGreaterThan(0));
      taskState.state = 'completed';
      const at = versions.findIndex((each) => each.number === number);
      versions.splice(at, 1);
      intervals.run(WATCH_POLL_MS);
    },
  };
}

const rowOf = async (text: string | RegExp) =>
  (await screen.findByRole('link', { name: text })).closest(
    'tr',
  ) as HTMLElement;

async function openMenu(
  user: ReturnType<typeof render>['user'],
  number: string,
) {
  const row = await rowOf(new RegExp(`^${number}`));
  await user.click(await within(row).findByRole('button', { name: 'Actions' }));
}

const deleteItem = () =>
  screen.findByRole('menuitem', { name: /Delete version/ });

// The Delete item of a row once the reads that protect versions have settled.
async function settledItem(
  user: ReturnType<typeof render>['user'],
  number: string,
) {
  await openMenu(user, number);
  return deleteItem();
}

describe(
  'Integration: which versions cannot be deleted, on the Versions tab',
  { tags: ['integration'] },
  () => {
    it('disables the version a distribution is bound to and names the distribution', async () => {
      serveLab({
        bind: (_repository, versionOf) => [
          { name: 'pinned', repository_version: versionOf(1) },
        ],
      });
      const { user } = render();

      await waitFor(async () => {
        await openMenu(user, '1');
        const item = await deleteItem();
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('"pinned"');
      });
      await user.keyboard('{Escape}');
      const other = await settledItem(user, '2');
      expect(other.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('disables the version whose publication a distribution is bound to', async () => {
      serveLab({
        published: [2],
        bind: (_repository, _versionOf, publicationOf) => [
          { name: 'by-publication', publication: publicationOf(2) },
        ],
      });
      const { user } = render();

      await waitFor(async () => {
        await openMenu(user, '2');
        const item = await deleteItem();
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('"by-publication"');
      });
    });

    it('disables the highest published version for a repository-bound distribution, and not the latest unpublished one', async () => {
      serveLab({
        published: [0, 2],
        bind: (repository) => [{ name: 'live', repository }],
      });
      const { user } = render();

      await waitFor(async () => {
        await openMenu(user, '2');
        const item = await deleteItem();
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('"live"');
      });
      await user.keyboard('{Escape}');
      const latest = await settledItem(user, '3');
      expect(latest.getAttribute('aria-disabled')).not.toBe('true');
      await user.keyboard('{Escape}');
      const older = await settledItem(user, '0');
      expect(older.getAttribute('aria-disabled')).not.toBe('true');
    });

    it('computes no protection from publications for a user who may not read them, and leaves the action to the server', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[DELETE]],
      });
      serveLab({
        published: [2],
        bind: (repository) => [{ name: 'live', repository }],
      });
      const { user } = render();

      await rowOf(/^2/);
      await waitFor(async () => {
        await openMenu(user, '2');
        const item = await deleteItem();
        expect(item.getAttribute('aria-disabled')).not.toBe('true');
      });
      expect(VIEW_PUBLICATIONS).toBe('file.view_filepublication');
    });

    it('disables the only version of a repository', async () => {
      serveLab({ count: 1 });
      const { user } = render();

      await waitFor(async () => {
        await openMenu(user, '0');
        const item = await deleteItem();
        expect(item.getAttribute('aria-disabled')).toBe('true');
        expect(item.textContent).toContain('The only version');
      });
    });

    it('offers no Delete to a user who may not delete the repository', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.modify_filerepository']],
      });
      serveLab();
      const { user } = render();

      await openMenu(user, '1');
      await screen.findByRole('menuitem', { name: /Revert to this version/ });
      expect(
        screen.queryByRole('menuitem', { name: /Delete version/ }),
      ).toBeNull();
    });

    it('offers Delete to a user who holds the delete permission only', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[DELETE]],
      });
      serveLab();
      const { user } = render();

      const item = await settledItem(user, '1');
      expect(item).toBeVisible();
    });
  },
);

describe(
  'Integration: deleting a version from the Versions tab',
  { tags: ['integration'] },
  () => {
    it('asks for confirmation that names the version and what follows, and Cancel sends nothing', async () => {
      const lab = serveLab();
      const { user } = render();

      await user.click(await settledItem(user, '1'));

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(
        'Delete version 1 of repository "tools"?',
      );
      expect(dialog.textContent).toContain(
        'Publications made from this version are deleted with it.',
      );
      expect(lab.deletes).toEqual([]);

      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.deletes).toEqual([]);
    });

    it('says that deleting the latest version rolls the repository back to the one before', async () => {
      serveLab({ count: 3 });
      const { user } = render();

      await user.click(await settledItem(user, '2'));

      const dialog = await screen.findByRole('dialog');
      expect(dialog.textContent).toContain(
        'This is the latest version. The repository goes back to version 1.',
      );
    });

    it('sends one DELETE of the version address, hands the task to the watcher and reads the versions again when it ends', async () => {
      const lab = serveLab();
      const { user } = render();

      await user.click(await settledItem(user, '1'));
      const dialog = await screen.findByRole('dialog');
      await user.dblClick(
        within(dialog).getByRole('button', { name: 'Delete' }),
      );

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.deletes).toEqual([`${lab.repository.pulp_href}versions/1/`]);
      expect(
        await screen.findByText(
          'Deletion started for version 1 of repository "tools".',
        ),
      ).toBeVisible();

      const reads = lab.versionQueries.length;
      await lab.finish(1);
      await waitFor(() =>
        expect(lab.versionQueries.length).toBeGreaterThan(reads),
      );
      await waitFor(() =>
        expect(screen.queryByRole('link', { name: /^1/ })).toBeNull(),
      );
    });

    it("shows the server's refusal as it was written and keeps the dialog open", async () => {
      const lab = serveLab({ refuse: true });
      const { user } = render();

      await user.click(await settledItem(user, '1'));
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(await within(dialog).findByText(REFUSAL)).toBeVisible();
      expect(lab.deletes).toHaveLength(1);
      expect(screen.getByRole('dialog')).toBeVisible();
      expect(
        within(dialog).getByRole('button', { name: 'Delete' }),
      ).toBeEnabled();
    });
  },
);

describe(
  'Integration: deleting a version from its own page',
  { tags: ['integration'] },
  () => {
    it('offers Delete on the page of a version that may be deleted, and sends the same request', async () => {
      const lab = serveLab();
      const { user } = render('/file/repositories/tools/versions/1');

      const button = await screen.findByRole('button', {
        name: 'Delete version',
      });
      await waitFor(() => expect(button).toBeEnabled());
      await user.click(button);
      const dialog = await screen.findByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(lab.deletes).toEqual([`${lab.repository.pulp_href}versions/1/`]);
    });

    it('disables Delete on the page of a protected version and says why', async () => {
      serveLab({
        bind: (_repository, versionOf) => [
          { name: 'pinned', repository_version: versionOf(1) },
        ],
      });
      render('/file/repositories/tools/versions/1');

      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Delete version' }),
        ).toHaveAttribute('aria-disabled', 'true'),
      );
      expect(screen.getByText(/"pinned"/)).toBeVisible();
    });

    it('offers no Delete on the page to a user who may not delete the repository', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.modify_filerepository']],
      });
      serveLab();
      render('/file/repositories/tools/versions/1');

      await screen.findByText('Base version');
      expect(
        screen.queryByRole('button', { name: 'Delete version' }),
      ).toBeNull();
    });
  },
);
