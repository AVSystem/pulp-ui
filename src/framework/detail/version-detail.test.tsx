import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { createQueryClient } from 'src/query/client';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  listOf,
  page,
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

const manifestOf = (name: string): PluginManifest => ({
  ...(PLUGIN_MANIFESTS.find(({ plugin }) => plugin === name) as PluginManifest),
  onFramework: true,
});

const FILE = manifestOf('file');
const DEB = manifestOf('deb');

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
      {useRoutes(guardRoutes(frameworkRoutes([FILE, DEB])))}
    </>
  );
}

function render(
  route: string,
  queryClient?: ReturnType<typeof createQueryClient>,
) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route, queryClient },
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

const VERSION_OF_ADDRESS = (repository: string, number: number) =>
  `${repository}versions/${number}/`;

describe(
  'Integration: the content types of a plugin and of the core',
  { tags: ['integration'] },
  () => {
    const DEB_PACKAGES = `${API}/content/deb/packages/`;
    const CORE = `${API}/content/`;

    interface DebRow {
      pulp_href: string;
      package: string;
      version: string;
      architecture: string;
    }
    const debRow = (name: string): DebRow => ({
      pulp_href: `${DEB_PACKAGES}${name}/`,
      package: name,
      version: '1.2-3',
      architecture: 'amd64',
    });
    const component = (name: string) => ({
      pulp_href: `${CORE}${name}/`,
      pulp_created: '2024-05-06T07:08:09.000000Z',
      pulp_labels: {},
    });

    function serveDeb() {
      const base = pluginRepository('deb', { name: 'tools' });
      const rows = [
        repositoryVersion({ pulp_href: base.pulp_href }, 1, {
          content_summary: {
            added: summaryOf('deb.package', 2),
            removed: {},
            present: {
              ...summaryOf('deb.package', 2),
              ...summaryOf('deb.release_component', 1),
            },
          },
        }),
        repositoryVersion({ pulp_href: base.pulp_href }, 2, {
          content_summary: {
            added: summaryOf('deb.release_component', 1),
            removed: {},
            present: {
              ...summaryOf('deb.package', 2),
              ...summaryOf('deb.release_component', 1),
            },
          },
        }),
      ];
      const repository = {
        ...base,
        latest_version_href: rows.at(-1)?.pulp_href ?? null,
      };
      const packages = listOf(DEB_PACKAGES, [debRow('curl'), debRow('wget')], {
        projected: projectedBy,
      });
      const core = listOf(CORE, [component('main')], {
        projected: projectedBy,
      });
      server.use(
        pluginListHandler('deb', 'repository', [repository]).handler,
        versionListHandler(repository, rows).handler,
        packages.handler,
        core.handler,
      );

      return { repository, packages, core };
    }

    it("lists the deb packages with the plugin's columns", async () => {
      const lab = serveDeb();

      render('/deb/repositories/tools/versions/1');

      const present = await screen.findByRole('grid', {
        name: 'Packages present',
      });
      expect(
        within(present)
          .getAllByRole('columnheader')
          .map(({ textContent }) => textContent?.trim()),
      ).toEqual(['Package', 'Version', 'Architecture']);
      expect(await within(present).findByText('curl')).toBeVisible();
      expect(within(present).getAllByText('1.2-3').length).toBe(2);
      const query = lab.packages.queries[0];
      expect(query.get('repository_version')).toBe(
        VERSION_OF_ADDRESS(lab.repository.pulp_href, 1),
      );
    });

    it('lists a type no descriptor declares through the core list filtered by its type and the version part, with the address and the creation time', async () => {
      const lab = serveDeb();

      render('/deb/repositories/tools/versions/2');

      const added = await screen.findByRole('grid', {
        name: 'deb.release_component added',
      });
      expect(
        within(added)
          .getAllByRole('columnheader')
          .map(({ textContent }) => textContent?.trim()),
      ).toEqual(['Content address', 'Created']);
      const row = (await within(added).findByText(`${CORE}main/`)).closest(
        'tr',
      ) as HTMLElement;
      expect(row.querySelector('time')?.getAttribute('datetime')).toBe(
        '2024-05-06T07:08:09.000000Z',
      );

      await screen.findByRole('grid', {
        name: 'deb.release_component present',
      });
      await waitFor(() => expect(lab.core.queries).toHaveLength(2));
      const version = VERSION_OF_ADDRESS(lab.repository.pulp_href, 2);
      expect(
        lab.core.queries.map((query) => ({
          type: query.get('pulp_type'),
          version: query.get('repository_version'),
          added: query.get('repository_version_added'),
        })),
      ).toEqual(
        expect.arrayContaining([
          { type: 'deb.release_component', version: null, added: version },
          { type: 'deb.release_component', version, added: null },
        ]),
      );
      expect(lab.core.queries[0].getAll('fields').sort()).toEqual([
        'pulp_created',
        'pulp_href',
        'pulp_labels',
      ]);
      // the declared type is not read through the core list
      expect(
        lab.core.queries.some(
          (query) => query.get('pulp_type') === 'deb.package',
        ),
      ).toBe(false);
    });
  },
);

describe(
  'Integration: a version that cannot be read or listed',
  { tags: ['integration'] },
  () => {
    it('shows an error with Retry, not a spinner, when the version read still answers 500 after the retries', async () => {
      const base = pluginRepository('file', { name: 'tools' });
      const repository = {
        ...base,
        latest_version_href: `${base.pulp_href}versions/1/`,
      };
      const rows = [repositoryVersion(base, 1)];
      const versions = versionListHandler(repository, rows);
      let answers = 0;
      let failing = true;
      server.use(
        pluginListHandler('file', 'repository', [repository]).handler,
        http.get(`*${versions.path}`, () => {
          answers += 1;
          return failing
            ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
            : HttpResponse.json(page(rows));
        }),
      );
      // the client of the application retries a server error twice
      const client = createQueryClient();
      client.setDefaultOptions({
        queries: { ...client.getDefaultOptions().queries, retryDelay: 1 },
      });

      const { user } = render('/file/repositories/tools/versions/1', client);

      expect(
        await screen.findByText('Repository version could not be displayed.'),
      ).toBeVisible();
      expect(answers).toBe(3);
      expect(screen.queryByRole('progressbar')).toBeNull();
      expect(screen.queryByText('Repository version not found')).toBeNull();

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(await screen.findByText('Version number')).toBeVisible();
    });

    it('shows a failed list as its own error with Retry while the other lists stay', async () => {
      serveLab({ versions: VERSION_TWO });
      let failing = true;
      server.use(
        http.get(`*${FILES}`, ({ request }) => {
          const query = new URL(request.url).searchParams;
          if (failing && query.has('repository_version_added')) {
            return HttpResponse.json({ detail: 'broken' }, { status: 500 });
          }
          return HttpResponse.json(
            page(
              query.has('repository_version_removed')
                ? [fileRow('removed-a')]
                : [fileRow('present-a')],
            ),
          );
        }),
      );

      const { user } = render('/file/repositories/tools/versions/2');

      expect(
        await screen.findByText('Content could not be displayed.'),
      ).toBeVisible();
      expect(
        await screen.findByRole('grid', { name: 'Files present' }),
      ).toBeVisible();
      expect(
        await screen.findByRole('grid', { name: 'Files removed' }),
      ).toBeVisible();
      expect(
        screen.getAllByText('Content could not be displayed.'),
      ).toHaveLength(1);

      failing = false;
      await user.click(screen.getByRole('button', { name: 'Retry' }));

      expect(
        await screen.findByRole('grid', { name: 'Files added' }),
      ).toBeVisible();
      expect(screen.queryByText('Content could not be displayed.')).toBeNull();
    });
  },
);
