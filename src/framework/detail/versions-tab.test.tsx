import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Link, useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import { servePublishLab } from 'src/test-utils/publish-lab';
import {
  distributionListHandler,
  listOf,
  page,
  pluginListHandler,
  pluginRepository,
  projectedBy,
  publicationListHandler,
  repositoryVersion,
  role,
  roleAssignment,
  versionListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';

const FILE: PluginManifest = {
  ...(PLUGIN_MANIFESTS.find(
    ({ plugin }) => plugin === 'file',
  ) as PluginManifest),
  onFramework: true,
};

function Routed() {
  const { pathname, search } = useLocation();

  return (
    <>
      <p data-testid='location'>{`${pathname}${search}`}</p>
      <Link to='/file/repositories/tools/versions/4'>go to four</Link>
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

const MODIFY = 'file.modify_filerepository';

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

type Version = ReturnType<typeof repositoryVersion>;

// A repository named tools with the numbers 0 to `count - 1` as versions, the
// last one the latest. `versions` replaces the generated ones.
function serveLab({
  count = 3,
  versions,
}: { count?: number; versions?: (repository: string) => Version[] } = {}) {
  const base = pluginRepository('file', { name: 'tools' });
  const rows = versions
    ? versions(base.pulp_href)
    : Array.from({ length: count }, (_, number) =>
        repositoryVersion(base, number, {
          pulp_created: `2024-01-${String(number + 1).padStart(2, '0')}T10:00:00.000000Z`,
        }),
      );
  const latest = rows.reduce<Version | undefined>(
    (best, row) => (!best || row.number > best.number ? row : best),
    undefined,
  );
  const repository = {
    ...base,
    latest_version_href: latest?.pulp_href ?? null,
  };
  const lab = {
    repository,
    versions: rows,
    repositories: pluginListHandler('file', 'repository', [repository]),
    list: versionListHandler(repository, rows),
  };
  server.use(
    lab.repositories.handler,
    lab.list.handler,
    distributionListHandler('file', []).handler,
    publicationListHandler('file', []).handler,
    listOf(`${API}/content/file/files/`, []).handler,
    listOf(`${API}/content/`, []).handler,
  );
  return lab;
}

function renderTab(route: string) {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const rowOf = async (text: string | RegExp) =>
  (await screen.findByRole('link', { name: text })).closest(
    'tr',
  ) as HTMLElement;

describe('Integration: the Versions tab', { tags: ['integration'] }, () => {
  it('lists the versions of the repository newest first, with the latest marked, the creation date and a link to each version', async () => {
    serveLab({ count: 3 });

    renderTab('/file/repositories/tools/versions');

    const latest = await rowOf(/^2/);
    expect(within(latest).getByText(/\(latest\)/)).toBeVisible();
    expect(
      within(latest).getByRole('link', { name: '2' }).getAttribute('href'),
    ).toBe('/file/repositories/tools/versions/2/');

    const body = screen.getAllByRole('row').slice(1);
    expect(
      body.map((row) => within(row).getByRole('link').textContent),
    ).toEqual(['2', '1', '0']);
    const older = await rowOf(/^1/);
    expect(within(older).queryByText(/\(latest\)/)).toBeNull();
    expect(older.querySelector('time')?.getAttribute('datetime')).toBe(
      '2024-01-02T10:00:00.000000Z',
    );
  });

  it('asks for ten versions of the repository, newest first, with one request for the whole page', async () => {
    const lab = serveLab({ count: 25 });

    renderTab('/file/repositories/tools/versions');

    await rowOf(/^24/);
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(10);
    expect(lab.list.queries).toHaveLength(1);
    expect(lab.list.queries[0].get('limit')).toBe('10');
    expect(lab.list.queries[0].get('offset')).toBe('0');
    expect(lab.list.queries[0].get('ordering')).toBe('-pulp_created');
    expect(lab.list.queries[0].has('number')).toBe(false);
  });

  it('reads the page the address names and sorts by the version number when asked, keeping the order in the address', async () => {
    const lab = serveLab({ count: 25 });

    const { user } = renderTab('/file/repositories/tools/versions?page=2');

    await rowOf(/^14/);
    expect(lab.list.queries.at(-1)?.get('offset')).toBe('10');

    await user.click(
      document.querySelector('[data-cy=sort_number]') as Element,
    );

    await waitFor(() =>
      expect(lab.list.queries.at(-1)?.get('ordering')).toBe('-number'),
    );
    expect(lab.list.queries.at(-1)?.get('offset')).toBe('0');
    expect(screen.getByTestId('location').textContent).toBe(
      '/file/repositories/tools/versions?sort=-number',
    );
    await rowOf(/^24/);
  });

  it('shows an empty state when the repository has no version', async () => {
    serveLab({ versions: () => [] });

    renderTab('/file/repositories/tools/versions');

    expect(await screen.findByText('No repository versions yet')).toBeVisible();
    expect(
      screen.getByText(
        'Repository versions will appear once the repository is modified.',
      ),
    ).toBeVisible();
  });

  it('shows a failed read as an error with Retry, never as no version, and reads again on Retry', async () => {
    const lab = serveLab({ count: 2 });
    let answers = 0;
    server.use(
      http.get(`*${lab.list.path}`, () => {
        answers += 1;
        return answers === 1
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(page(lab.versions.slice().reverse()));
      }),
    );

    const { user } = renderTab('/file/repositories/tools/versions');

    expect(
      await screen.findByText('Repository versions could not be displayed.'),
    ).toBeVisible();
    expect(screen.queryByText('No repository versions yet')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await rowOf(/^1/);
    expect(answers).toBe(2);
  });

  it('is the tab after Details and offers the Versions tab as a link to its own address', async () => {
    serveLab();

    renderTab('/file/repositories/tools/versions');

    const tab = await screen.findByRole('link', { name: 'Versions' });
    expect(tab.getAttribute('href')).toBe('/file/repositories/tools/versions/');
    expect(tab.getAttribute('aria-current')).toBe('page');
  });
});

describe('Integration: a version', { tags: ['integration'] }, () => {
  const summary = (type: string, count: number) => ({
    [type]: { count, href: `${API}/content/${type}/?repository_version=x` },
  });

  function serveVersions() {
    return serveLab({
      versions: (repository) => {
        const base = { pulp_href: repository };
        return [
          repositoryVersion(base, 1, {
            content_summary: {
              added: summary('file.file', 4),
              removed: {},
              present: summary('file.file', 4),
            },
          }),
          repositoryVersion(base, 2, {
            base_version: `${repository}versions/1/`,
            pulp_created: '2024-03-05T10:00:00.000000Z',
            content_summary: {
              added: summary('file.file', 2),
              removed: summary('file.file', 1),
              present: {
                ...summary('file.file', 5),
                'file.other': { count: 3 },
              },
            },
          }),
        ];
      },
    });
  }

  it('reads the version by its number through the versions list and shows what it added, removed and holds', async () => {
    const lab = serveVersions();

    renderTab('/file/repositories/tools/versions/2');

    expect(
      await screen.findByRole('grid', { name: 'Content summary' }),
    ).toBeVisible();
    // The page also asks how many versions there are, which is no lookup by
    // number.
    const lookups = lab.list.queries.filter((each) => each.has('number'));
    const query = lookups.at(-1) as URLSearchParams;
    expect(query.get('number')).toBe('2');
    expect(query.get('limit')).toBe('1');
    expect(lookups).toHaveLength(1);

    const summary = screen.getByRole('grid', { name: 'Content summary' });
    const files = within(summary).getByRole('row', { name: /Files/ });
    expect(
      within(files)
        .getAllByRole('cell')
        .map(({ textContent }) => textContent),
    ).toEqual(['Files', '5', '2', '1']);
    const other = within(summary).getByRole('row', { name: /file\.other/ });
    expect(
      within(other)
        .getAllByRole('cell')
        .map(({ textContent }) => textContent),
    ).toEqual(['file.other', '3', '0', '0']);
    expect(document.querySelector('time')?.getAttribute('datetime')).toBe(
      '2024-03-05T10:00:00.000000Z',
    );
  });

  it('links to the base version by the number its address ends in, and says None for a version without one', async () => {
    serveVersions();

    const first = renderTab('/file/repositories/tools/versions/2');

    const base = await screen.findByRole('link', { name: '1' });
    expect(base.getAttribute('href')).toBe(
      '/file/repositories/tools/versions/1/',
    );
    first.unmount();

    renderTab('/file/repositories/tools/versions/1');

    await screen.findByText('Version number');
    const term = screen.getByText('Base version');
    expect(term.closest('div')?.querySelector('dd')?.textContent).toBe('None');
  });

  it('shows an empty content summary as None', async () => {
    serveLab({
      versions: (repository) => [
        repositoryVersion({ pulp_href: repository }, 1),
      ],
    });

    renderTab('/file/repositories/tools/versions/1');

    expect(
      await screen.findByText('This version holds no content.'),
    ).toBeVisible();
    expect(screen.queryByRole('grid', { name: 'Content summary' })).toBeNull();
  });

  it('says a number that names no version is not found, never an endless spinner', async () => {
    serveVersions();

    renderTab('/file/repositories/tools/versions/9');

    expect(
      await screen.findByText('Repository version not found'),
    ).toBeVisible();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows a failed read as an error with Retry and reads again on Retry', async () => {
    const lab = serveVersions();
    let answers = 0;
    server.use(
      http.get(`*${lab.list.path}`, ({ request }) => {
        if (!new URL(request.url).searchParams.has('number')) {
          return HttpResponse.json(page(lab.versions.slice().reverse()));
        }
        answers += 1;
        return answers === 1
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json(page([lab.versions[1]]));
      }),
    );

    const { user } = renderTab('/file/repositories/tools/versions/2');

    expect(
      await screen.findByText('Repository version could not be displayed.'),
    ).toBeVisible();
    expect(screen.queryByText('Repository version not found')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Version number')).toBeVisible();
    expect(answers).toBe(2);
  });

  it('ignores the late answer for another number: the version on screen is the one the address names', async () => {
    const lab = serveVersions();
    const release: { three: () => void } = { three: () => undefined };
    const gate = new Promise<void>((resolve) => {
      release.three = resolve;
    });
    server.use(
      http.get(`*${lab.list.path}`, async ({ request }) => {
        const number = new URL(request.url).searchParams.get('number');
        if (number === '3') {
          await gate;
          return HttpResponse.json(
            page([
              repositoryVersion({ pulp_href: lab.repository.pulp_href }, 3, {
                content_summary: {
                  added: summary('zz.late', 99),
                  removed: {},
                  present: {},
                },
              }),
            ]),
          );
        }
        return HttpResponse.json(
          page(lab.versions.filter((row) => String(row.number) === number)),
        );
      }),
    );
    // the address of version 4 holds no version; serve one for it
    lab.versions.push(
      repositoryVersion({ pulp_href: lab.repository.pulp_href }, 4, {
        content_summary: {
          added: summary('zz.current', 7),
          removed: {},
          present: {},
        },
      }),
    );

    const { user } = renderTab('/file/repositories/tools/versions/3');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('/3'),
    );

    await user.click(screen.getByRole('link', { name: 'go to four' }));
    const summaryOf = async () =>
      within(await screen.findByRole('grid', { name: 'Content summary' }));
    expect((await summaryOf()).getByText('zz.current')).toBeVisible();

    release.three();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('zz.late')).toBeNull();
    expect((await summaryOf()).getByText('zz.current')).toBeVisible();
  });

  it('sends no request for a number that is too large to be a version number', async () => {
    const lab = serveVersions();

    renderTab('/file/repositories/tools/versions/99999999999999999999');

    expect(
      await screen.findByText('Repository version not found'),
    ).toBeVisible();
    expect(lab.list.queries.filter((each) => each.has('number'))).toHaveLength(
      0,
    );
  });

  it('shows Not Found for an address whose version is not a number', async () => {
    const lab = serveVersions();

    renderTab('/file/repositories/tools/versions/abc');

    expect(await screen.findByText('404 - Page not found')).toBeVisible();
    expect(lab.list.queries).toHaveLength(0);
  });
});

describe(
  'Integration: who is offered the revert action',
  { tags: ['integration'] },
  () => {
    it('shows no row action to a user who holds no modify permission anywhere or on this repository', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [['file.change_filerepository']],
      });
      serveLab({ count: 2 });
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));

      renderTab('/file/repositories/tools/versions');

      await rowOf(/^1/);
      expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    });

    it('offers it to a user who holds the modify permission on every repository', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[MODIFY]],
      });
      serveLab({ count: 2 });
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));

      const { user } = renderTab('/file/repositories/tools/versions');

      const row = await rowOf(/^0/);
      await user.click(within(row).getByRole('button', { name: 'Actions' }));
      expect(
        await screen.findByRole('menuitem', { name: /Revert to this version/ }),
      ).toBeVisible();
    });

    it('offers it to a user who holds the modify role on this repository only', async () => {
      permissions.stop();
      permissions = servePermissions({ id: 7, isStaff: false });
      const lab = serveLab({ count: 2 });
      server.use(
        listOf(
          `${API}/users/7/roles/`,
          [roleAssignment('owner', lab.repository.pulp_href)],
          {
            pageSize: 1000,
            matching: (row, query) =>
              query.get('content_object') !== 'null' ||
              row.content_object === null,
            projected: projectedBy,
          },
        ).handler,
        http.get(`*${API}/roles/`, () =>
          HttpResponse.json(
            page([role({ name: 'owner', permissions: [MODIFY] })]),
          ),
        ),
      );

      const { user } = renderTab('/file/repositories/tools/versions');

      const row = await rowOf(/^0/);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      expect(
        await screen.findByRole('menuitem', { name: /Revert to this version/ }),
      ).toBeVisible();
    });

    it('does not offer to revert to the latest version, and says why', async () => {
      serveLab({ count: 2 });

      const { user } = renderTab('/file/repositories/tools/versions');

      const row = await rowOf(/^1/);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      const item = await screen.findByRole('menuitem', {
        name: /Revert to this version/,
      });
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.textContent).toContain('Already the current version');
    });
  },
);

describe(
  'Integration: publishing one version from the Versions tab',
  { tags: ['integration'] },
  () => {
    const ADD = 'file.add_filepublication';

    function servePublishing(lab: ReturnType<typeof serveLab>) {
      server.use(
        distributionListHandler('file', []).handler,
        publicationListHandler('file', []).handler,
      );
      return servePublishLab({ repository: lab.repository });
    }

    it('publishes the version of the row it is chosen on, and no other', async () => {
      const lab = serveLab({ count: 3 });
      const publishing = servePublishing(lab);

      const { user } = renderTab('/file/repositories/tools/versions');

      const row = await rowOf(/^1/);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: 'Publish this version' }),
      );
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).getByText('Publish version 1 of "tools"'),
      ).toBeVisible();
      await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

      await waitFor(() => expect(publishing.publishes).toHaveLength(1));
      expect(publishing.publishes[0]).toEqual({
        repository_version: lab.versions[1]?.pulp_href,
      });
    });

    it('offers it, and nothing to revert, to a user who holds the add publication permission only', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[ADD]],
      });
      const lab = serveLab({ count: 2 });
      servePublishing(lab);
      server.use(http.get(`*${API}/roles/`, () => HttpResponse.json(page([]))));

      const { user } = renderTab('/file/repositories/tools/versions');

      const row = await rowOf(/^0/);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      expect(
        await screen.findByRole('menuitem', { name: 'Publish this version' }),
      ).toBeVisible();
      expect(screen.queryByRole('menuitem', { name: /Revert/ })).toBeNull();
    });
  },
);
