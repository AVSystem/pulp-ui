import { screen, waitFor, within } from '@testing-library/react';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  listOf,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  repositoryVersion,
  versionListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

// The page of one repository version as a user meets it: its summary and the
// content it holds, added and removed, a page at a time. The file plugin
// declares its content type, so the lists are the plugin's own.

const API = '/pulp/api/v3';
const FILES = `${API}/content/file/files/`;

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
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

function render(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const summaryOf = (type: string, count: number) => ({
  [type]: { count, href: `${FILES}?x=${count}` },
});

interface FileRow {
  pulp_href: string;
  relative_path: string;
  pulp_created: string;
  // a field the list never asks for
  sha256: string;
}

const fileRow = (name: string): FileRow => ({
  pulp_href: `${FILES}${name}/`,
  relative_path: `${name}.txt`,
  pulp_created: '2024-02-03T04:05:06.000000Z',
  sha256: 'ab'.repeat(32),
});

// A file repository named tools with the given versions, and the file content
// list of the lab: the answer depends on which version filter the request
// carries.
function serveLab({
  versions,
  present = [fileRow('present-a'), fileRow('present-b'), fileRow('present-c')],
  added = [fileRow('added-a'), fileRow('added-b')],
  removed = [fileRow('removed-a')],
}: {
  versions: (repository: string) => ReturnType<typeof repositoryVersion>[];
  present?: FileRow[];
  added?: FileRow[];
  removed?: FileRow[];
}) {
  const base = pluginRepository('file', { name: 'tools' });
  const rows = versions(base.pulp_href);
  const repository = {
    ...base,
    latest_version_href: rows.at(-1)?.pulp_href ?? null,
  };
  const content = listOf(FILES, [...present, ...added, ...removed], {
    pageSize: 100,
    matching: (row, query) => {
      if (query.has('repository_version')) {
        return present.includes(row);
      }
      if (query.has('repository_version_added')) {
        return added.includes(row);
      }
      if (query.has('repository_version_removed')) {
        return removed.includes(row);
      }
      return true;
    },
    projected: projectedBy,
  });
  server.use(
    pluginListHandler('file', 'repository', [repository]).handler,
    versionListHandler(repository, rows).handler,
    content.handler,
  );

  return { repository, content };
}

const VERSION_TWO = (repository: string) => [
  repositoryVersion({ pulp_href: repository }, 1, {
    content_summary: {
      added: summaryOf('file.file', 4),
      removed: {},
      present: summaryOf('file.file', 4),
    },
  }),
  repositoryVersion({ pulp_href: repository }, 2, {
    base_version: null,
    content_summary: {
      added: summaryOf('file.file', 2),
      removed: summaryOf('file.file', 1),
      present: summaryOf('file.file', 3),
    },
  }),
];

const cellsOf = (row: HTMLElement) =>
  within(row)
    .getAllByRole('cell')
    .map(({ textContent }) => textContent);

describe(
  'Integration: the content of a repository version',
  { tags: ['integration'] },
  () => {
    it('shows present 3, added 2 and removed 1 and a server-paged list of each, filtered by the version', async () => {
      const lab = serveLab({ versions: VERSION_TWO });
      const version = `${lab.repository.pulp_href}versions/2/`;

      render('/file/repositories/tools/versions/2');

      const summary = await screen.findByRole('grid', {
        name: 'Content summary',
      });
      const header = within(summary)
        .getAllByRole('columnheader')
        .map(({ textContent }) => textContent);
      expect(header).toEqual(['Content type', 'Present', 'Added', 'Removed']);
      expect(
        cellsOf(within(summary).getByRole('row', { name: /Files/ })),
      ).toEqual(['Files', '3', '2', '1']);

      const present = await screen.findByRole('grid', {
        name: 'Files present',
      });
      expect(await within(present).findByText('present-a.txt')).toBeVisible();
      const added = screen.getByRole('grid', { name: 'Files added' });
      expect(await within(added).findByText('added-b.txt')).toBeVisible();
      const removed = screen.getByRole('grid', { name: 'Files removed' });
      expect(await within(removed).findByText('removed-a.txt')).toBeVisible();

      await waitFor(() => expect(lab.content.queries).toHaveLength(3));
      const filters = lab.content.queries.map((query) => ({
        version: query.get('repository_version'),
        added: query.get('repository_version_added'),
        removed: query.get('repository_version_removed'),
      }));
      expect(filters).toHaveLength(3);
      expect(filters).toContainEqual({
        version,
        added: null,
        removed: null,
      });
      expect(filters).toContainEqual({
        version: null,
        added: version,
        removed: null,
      });
      expect(filters).toContainEqual({
        version: null,
        added: null,
        removed: version,
      });
      for (const query of lab.content.queries) {
        expect(query.get('limit')).toBe('20');
        expect(query.get('offset')).toBe('0');
        expect(query.getAll('fields')).toContain('relative_path');
      }
    });

    it('shows the plugin columns, the path and the creation time, and nothing the list did not ask for', async () => {
      serveLab({ versions: VERSION_TWO });

      render('/file/repositories/tools/versions/2');

      const present = await screen.findByRole('grid', {
        name: 'Files present',
      });
      const headers = within(present)
        .getAllByRole('columnheader')
        .map(({ textContent }) => textContent?.trim());
      expect(headers).toEqual(['Relative path', 'Created']);
      const row = (await within(present).findByText('present-a.txt')).closest(
        'tr',
      ) as HTMLElement;
      expect(row.querySelector('time')?.getAttribute('datetime')).toBe(
        '2024-02-03T04:05:06.000000Z',
      );
      expect(screen.queryByText('ab'.repeat(32))).toBeNull();
    });

    it('says an empty section is empty and sends no request for it', async () => {
      const lab = serveLab({
        versions: (repository) => [
          repositoryVersion({ pulp_href: repository }, 1, {
            content_summary: {
              added: {},
              removed: {},
              present: summaryOf('file.file', 3),
            },
          }),
          repositoryVersion({ pulp_href: repository }, 2, {
            content_summary: {
              added: {},
              removed: {},
              present: summaryOf('file.file', 3),
            },
          }),
        ],
      });

      render('/file/repositories/tools/versions/2');

      expect(await screen.findByText('Nothing was added.')).toBeVisible();
      expect(screen.getByText('Nothing was removed.')).toBeVisible();
      await screen.findByRole('grid', { name: 'Files present' });
      expect(screen.queryByRole('grid', { name: 'Files added' })).toBeNull();
      expect(screen.queryByRole('grid', { name: 'Files removed' })).toBeNull();
      expect(lab.content.queries).toHaveLength(1);
      expect(lab.content.queries[0].has('repository_version')).toBe(true);
    });

    it('shows version 0 with its content and says there is no earlier version to compare with', async () => {
      const lab = serveLab({
        versions: (repository) => [
          repositoryVersion({ pulp_href: repository }, 0, {
            content_summary: {
              added: summaryOf('file.file', 3),
              removed: {},
              present: summaryOf('file.file', 3),
            },
          }),
        ],
      });

      render('/file/repositories/tools/versions/0');

      await screen.findByRole('grid', { name: 'Files present' });
      expect(screen.getAllByText('No earlier version').length).toBeGreaterThan(
        0,
      );
      expect(screen.queryByRole('grid', { name: 'Files added' })).toBeNull();
      expect(screen.queryByRole('grid', { name: 'Files removed' })).toBeNull();
      expect(lab.content.queries).toHaveLength(1);
      expect(lab.content.queries[0].has('repository_version')).toBe(true);
    });

    it('pages one list without moving the others', async () => {
      const many = Array.from({ length: 25 }, (_, index) =>
        fileRow(`bulk-${String(index).padStart(2, '0')}`),
      );
      const lab = serveLab({
        versions: (repository) => [
          repositoryVersion({ pulp_href: repository }, 1, {
            content_summary: {
              added: summaryOf('file.file', 25),
              removed: {},
              present: summaryOf('file.file', 25),
            },
          }),
          repositoryVersion({ pulp_href: repository }, 2, {
            content_summary: {
              added: summaryOf('file.file', 25),
              removed: {},
              present: summaryOf('file.file', 25),
            },
          }),
        ],
        present: many,
        added: many,
        removed: [],
      });

      const { user } = render('/file/repositories/tools/versions/2');

      const present = await screen.findByRole('grid', {
        name: 'Files present',
      });
      expect(await within(present).findByText('bulk-00.txt')).toBeVisible();
      const before = lab.content.queries.length;

      const next = screen.getAllByRole('button', {
        name: 'Go to next page',
      })[0];
      await user.click(next);

      await waitFor(() =>
        expect(
          lab.content.queries.filter((query) => query.get('offset') === '20'),
        ).toHaveLength(1),
      );
      expect(lab.content.queries.length).toBe(before + 1);
      const moved = lab.content.queries.find(
        (query) => query.get('offset') === '20',
      ) as URLSearchParams;
      expect(
        moved.has('repository_version') !==
          moved.has('repository_version_added'),
      ).toBe(true);
    });
  },
);
