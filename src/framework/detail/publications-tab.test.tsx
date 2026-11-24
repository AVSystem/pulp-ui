import { screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useLocation, useRoutes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { guardRoutes } from 'src/app-routes';
import { PermissionsKnown, servePermissions } from 'src/test-utils/permissions';
import {
  corePublicationListHandler,
  distributionListHandler,
  listOf,
  pluginDistribution,
  pluginListHandler,
  pluginPublication,
  pluginRepository,
  publicationListHandler,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { PLUGIN_MANIFESTS, type PluginManifest } from '../manifest';
import { frameworkRoutes } from '../routes';

const API = '/pulp/api/v3';
const VIEW = 'file.view_filepublication';
const DELETE = 'file.delete_filepublication';

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
      {useRoutes(guardRoutes(frameworkRoutes([FILE])))}
    </>
  );
}

let permissions: { stop: () => void };

beforeEach(() => {
  permissions = servePermissions({ id: 7, isStaff: true });
});

afterEach(() => {
  permissions.stop();
});

type Publication = ReturnType<typeof pluginPublication>;
type Distribution = ReturnType<typeof pluginDistribution>;

const repository = pluginRepository('file', { name: 'tools' });
const versionHref = (number: number) =>
  `${repository.pulp_href}versions/${number}/`;

// A publication of the repository made from one version, with the options the
// file plugin's own read answers with.
function publishedFrom(
  version: number,
  overrides: Partial<Publication> = {},
): Publication {
  return pluginPublication('file', {
    repository: repository.pulp_href,
    repository_version: versionHref(version),
    pulp_created: `2024-01-0${version + 1}T10:00:00.000000Z`,
    manifest: 'PULP_MANIFEST',
    sha256sums: 'disabled',
    ...overrides,
  });
}

// The repository, its publications (answered by the cross-plugin list and by
// the file plugin's own list), its distributions, and a delete that removes the
// publication from both lists as the server does.
function serveLab({
  publications,
  distributions = (_publications: Publication[]) => [] as Distribution[],
  latest = 2,
}: {
  publications: Publication[];
  distributions?: (publications: Publication[]) => Distribution[];
  latest?: number;
}) {
  const rows = [...publications];
  const own = {
    ...repository,
    latest_version_href: versionHref(latest),
  };
  const deleted: string[] = [];
  const lab = {
    rows,
    deleted,
    repositories: pluginListHandler('file', 'repository', [own]),
    core: corePublicationListHandler(rows),
    plugin: publicationListHandler('file', rows),
    distributions: distributionListHandler('file', distributions(rows)),
  };
  server.use(
    lab.repositories.handler,
    lab.core.handler,
    lab.plugin.handler,
    lab.distributions.handler,
    http.delete(`*${API}/publications/file/file/:id/`, ({ request }) => {
      const path = new URL(request.url).pathname;
      deleted.push(path);
      const at = rows.findIndex(({ pulp_href }) => pulp_href === path);
      if (at >= 0) {
        rows.splice(at, 1);
      }
      return new HttpResponse(null, { status: 204 });
    }),
    // read for a user who is not an administrator
    listOf(`${API}/roles/`, [], { pageSize: 1000 }).handler,
  );
  return lab;
}

function renderTab(route = '/file/repositories/tools/publications') {
  return renderWithProviders(
    <AppContextProvider>
      <PermissionsKnown>
        <Routed />
      </PermissionsKnown>
    </AppContextProvider>,
    { route },
  );
}

const rowOf = async (version: number) =>
  (await screen.findByRole('link', { name: String(version) })).closest(
    'tr',
  ) as HTMLElement;

describe('Integration: the Publications tab', { tags: ['integration'] }, () => {
  it('lists the publications of the repository newest first with the version, the creation date and the file options', async () => {
    serveLab({
      publications: [
        publishedFrom(0, { manifest: 'INDEX' }),
        publishedFrom(2, { sha256sums: 'root' }),
        publishedFrom(1),
      ],
    });

    renderTab();

    const newest = await rowOf(2);
    expect(
      within(newest).getByRole('link', { name: '2' }).getAttribute('href'),
    ).toBe('/file/repositories/tools/versions/2/');
    expect(newest.querySelector('time')?.getAttribute('datetime')).toBe(
      '2024-01-03T10:00:00.000000Z',
    );
    await waitFor(() => expect(within(newest).getByText('root')).toBeVisible());
    expect(within(await rowOf(0)).getByText('INDEX')).toBeVisible();
    const order = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('link')[0]?.textContent);
    expect(order).toEqual(['2', '1', '0']);
  });

  it('asks for one page of the repository, newest first, and sends a bounded number of requests', async () => {
    const lab = serveLab({
      publications: Array.from({ length: 60 }, (_, number) =>
        publishedFrom(number),
      ),
      latest: 59,
    });

    renderTab();

    await rowOf(59);
    await waitFor(() =>
      expect(screen.getAllByRole('row').slice(1)).toHaveLength(50),
    );
    const [first, ...more] = lab.core.queries;
    expect(more).toEqual([]);
    expect(first?.get('repository')).toBe(repository.pulp_href);
    expect(first?.getAll('ordering')).toEqual(['-pulp_created']);
    expect(first?.get('limit')).toBe('50');
    expect(first?.get('offset')).toBe('0');
    // the options of the 50 rows with one request, the publications of the
    // repository with the pages of the index, the distributions once
    await waitFor(() => expect(lab.plugin.queries.length).toBeGreaterThan(0));
    expect(lab.plugin.queries.length).toBeLessThanOrEqual(3);
    expect(lab.distributions.queries.length).toBeLessThanOrEqual(1);
  });

  it('lists each distribution under the publication it really serves', async () => {
    const [v0, v1, v2] = [publishedFrom(0), publishedFrom(1), publishedFrom(2)];
    serveLab({
      publications: [v0, v1, v2],
      distributions: () => [
        pluginDistribution('file', {
          name: 'by-repository',
          repository: repository.pulp_href,
        }),
        pluginDistribution('file', {
          name: 'by-publication',
          publication: (v0 as Publication).pulp_href,
        }),
        pluginDistribution('file', {
          name: 'by-version',
          repository_version: versionHref(1),
        }),
      ],
    });

    renderTab();

    expect(
      within(await rowOf(2)).getByRole('link', { name: 'by-repository' }),
    ).toHaveAttribute('href', '/file/distributions/by-repository/');
    expect(
      await within(await rowOf(1)).findByRole('link', { name: 'by-version' }),
    ).toBeVisible();
    expect(
      await within(await rowOf(0)).findByRole('link', {
        name: 'by-publication',
      }),
    ).toBeVisible();
    expect(
      within(await rowOf(2)).queryByRole('link', { name: 'by-version' }),
    ).toBeNull();
  });

  describe('deleting', () => {
    const open = async (
      user: ReturnType<typeof renderTab>['user'],
      version: number,
    ) => {
      const row = await rowOf(version);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );
      await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
      return screen.findByRole('dialog');
    };

    it('says a repository-bound distribution will serve nothing when the only publication goes', async () => {
      serveLab({
        publications: [publishedFrom(1)],
        distributions: () => [
          pluginDistribution('file', {
            name: 'by-repository',
            repository: repository.pulp_href,
          }),
        ],
      });

      const { user } = renderTab();
      const dialog = await open(user, 1);

      const item = (await within(dialog).findByText('by-repository')).closest(
        'li',
      ) as HTMLElement;
      expect(within(item).getByText('will serve nothing (404)')).toBeVisible();
    });

    it('says a repository-bound distribution will serve the older version when the newest goes, and a publication-bound one nothing', async () => {
      const v1 = publishedFrom(1);
      const v2 = publishedFrom(2);
      serveLab({
        publications: [v1, v2],
        distributions: () => [
          pluginDistribution('file', {
            name: 'by-repository',
            repository: repository.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'by-publication',
            publication: v2.pulp_href,
          }),
          pluginDistribution('file', {
            name: 'pinned-to-older',
            publication: v1.pulp_href,
          }),
        ],
      });

      const { user } = renderTab();
      const dialog = await open(user, 2);

      const falling = (
        await within(dialog).findByText('by-repository')
      ).closest('li') as HTMLElement;
      expect(within(falling).getByText('will serve version 1')).toBeVisible();
      const pinned = within(dialog)
        .getByText('by-publication')
        .closest('li') as HTMLElement;
      expect(
        within(pinned).getByText('will serve nothing (404)'),
      ).toBeVisible();
      expect(within(dialog).queryByText('pinned-to-older')).toBeNull();
    });

    it('says nothing is affected when no distribution serves the publication', async () => {
      serveLab({ publications: [publishedFrom(1)] });

      const { user } = renderTab();
      const dialog = await open(user, 1);

      expect(
        await within(dialog).findByText(
          'No distribution serves this publication.',
        ),
      ).toBeVisible();
    });

    it('sends one DELETE and reads the tab, the publications and the distributions again', async () => {
      const v1 = publishedFrom(1);
      const v2 = publishedFrom(2);
      const lab = serveLab({
        publications: [v1, v2],
        distributions: () => [
          pluginDistribution('file', {
            name: 'by-repository',
            repository: repository.pulp_href,
          }),
        ],
      });

      const { user } = renderTab();
      const dialog = await open(user, 2);
      await within(dialog).findByText('by-repository');
      const coreBefore = lab.core.queries.length;
      const distributionsBefore = lab.distributions.queries.length;
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      await waitFor(() => expect(lab.deleted).toEqual([v2.pulp_href]));
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(lab.core.queries.length).toBeGreaterThan(coreBefore),
      );
      await waitFor(() =>
        expect(lab.distributions.queries.length).toBeGreaterThan(
          distributionsBefore,
        ),
      );
      await waitFor(() =>
        expect(screen.queryByRole('link', { name: '2' })).toBeNull(),
      );
      expect(lab.deleted).toHaveLength(1);
    });

    it('shows a refusal in the dialog and keeps the publication listed', async () => {
      const v1 = publishedFrom(1);
      serveLab({ publications: [v1] });
      server.use(
        http.delete(`*${API}/publications/file/file/:id/`, () =>
          HttpResponse.json(
            { detail: 'You do not have permission.' },
            { status: 403 },
          ),
        ),
      );

      const { user } = renderTab();
      const dialog = await open(user, 1);
      await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

      expect(
        await within(dialog).findByText(/You do not have permission/),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: '1' })).toBeVisible();
    });

    it('offers Delete to a user who holds the permission and none to one who does not', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[VIEW]],
      });
      serveLab({ publications: [publishedFrom(1)] });

      renderTab();

      await rowOf(1);
      expect(screen.queryByRole('button', { name: 'Actions' })).toBeNull();
    });

    it('offers Delete to a user who holds the delete permission', async () => {
      permissions.stop();
      permissions = servePermissions({
        id: 7,
        isStaff: false,
        own: [[VIEW, DELETE]],
      });
      serveLab({ publications: [publishedFrom(1)] });

      const { user } = renderTab();
      const row = await rowOf(1);
      await user.click(
        await within(row).findByRole('button', { name: 'Actions' }),
      );

      expect(
        await screen.findByRole('menuitem', { name: 'Delete' }),
      ).toBeVisible();
    });
  });

  it('says a user who may not read publications cannot see them, and reads none', async () => {
    permissions.stop();
    permissions = servePermissions({ id: 7, isStaff: false, own: [[]] });
    const lab = serveLab({ publications: [publishedFrom(1)] });

    renderTab();

    expect(
      await screen.findByText(/You may not read the publications/),
    ).toBeVisible();
    expect(lab.core.queries).toHaveLength(0);
  });

  it('says there are no publications when the repository has none', async () => {
    serveLab({ publications: [] });

    renderTab();

    expect(await screen.findByText('No publications yet')).toBeVisible();
  });
});
