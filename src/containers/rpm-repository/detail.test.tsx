import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import {
  distribution,
  listOf,
  publication,
  repository,
} from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import RPMRepositoryDetail from './detail';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/rpm/rpm/00000000-0000-4000-8000-0000000000aa/`;
const OTHER_REPOSITORY_HREF = `${API}/repositories/rpm/rpm/00000000-0000-4000-8000-0000000000bb/`;

const tools = repository({
  name: 'zz-test-rpm',
  pulp_href: REPOSITORY_HREF,
  retain_repo_versions: null,
  retain_package_versions: 0,
  autopublish: true,
  remote: null,
});

// The distribution lists the page reads: the ones bound to the repository are
// asked for with a repository filter, every distribution of the plugin is read
// once without it.
function serveDistributions(rows: ReturnType<typeof distribution>[]) {
  server.use(
    listOf(`${API}/distributions/rpm/rpm/`, rows, {
      matching: (row, query) =>
        query.has('repository')
          ? row.repository === query.get('repository')
          : true,
    }).handler,
  );
}

function servePublications(rows: ReturnType<typeof publication>[]) {
  server.use(
    listOf(`${API}/publications/rpm/rpm/`, rows, {
      matching: (row, query) =>
        query.has('repository')
          ? row.repository === query.get('repository')
          : true,
    }).handler,
  );
}

function serveRepository(row = tools) {
  server.use(
    listOf(`${API}/repositories/rpm/rpm/`, [row], {
      matching: (r, query) => r.name === query.get('name'),
    }).handler,
  );
}

function renderDetail(tab: 'details' | 'distributions' = 'details') {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.rpm.repository.detail}
          element={<RPMRepositoryDetail />}
        />
      </Routes>
    </AppContextProvider>,
    { route: `/rpm/repositories/detail/zz-test-rpm?tab=${tab}` },
  );
}

describe('RPM repository details', () => {
  it('shows the base_url the server reports for each distribution, never a URL built from the base path', async () => {
    const first = distribution({
      name: 'zz-first',
      base_path: 'zz-first',
      base_url: 'https://pulp.example/mirror-one/zz-first/',
      repository: REPOSITORY_HREF,
    });
    const second = distribution({
      name: 'zz-second',
      base_path: 'zz-second',
      base_url: 'https://pulp.example/mirror-two/other/',
      repository: REPOSITORY_HREF,
    });
    serveRepository();
    serveDistributions([first, second]);
    servePublications([publication({ repository: REPOSITORY_HREF })]);
    renderDetail();

    expect(
      await screen.findByText('https://pulp.example/mirror-one/zz-first/'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('https://pulp.example/mirror-two/other/'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/\/pulp\/content\/zz-/)).toBeNull();
    expect(screen.queryByText(/Not served/)).toBeNull();
  });

  it('says "Not served" next to a distribution whose repository has no publication', async () => {
    serveRepository();
    serveDistributions([
      distribution({
        name: 'zz-bare',
        base_path: 'zz-bare',
        repository: REPOSITORY_HREF,
      }),
    ]);
    servePublications([]);
    renderDetail();

    expect(await screen.findByText(/Not served/)).toBeInTheDocument();
  });

  it('shows exactly one Autopublish row', async () => {
    serveRepository();
    serveDistributions([]);
    servePublications([]);
    renderDetail();

    await screen.findByText('Retained package versions');

    expect(screen.getAllByText('Autopublish')).toHaveLength(1);
    expect(screen.getByText('Enabled')).toBeInTheDocument();
  });

  it('shows why the distributions are missing when they could not be loaded, instead of "None"', async () => {
    serveRepository();
    server.use(
      http.get(`*${API}/distributions/rpm/rpm/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    servePublications([]);
    renderDetail();

    expect(
      await screen.findByText(/Distributions could not be loaded/),
    ).toBeInTheDocument();
  });
});

describe('RPM repository Distributions tab', () => {
  it('lists distributions bound to the repository, to its publication and to one of its versions, with the server URL and a CLI line using it', async () => {
    const publicationRow = publication({ repository: REPOSITORY_HREF });
    serveRepository();
    serveDistributions([
      distribution({
        name: 'zz-bound',
        base_path: 'bp-bound',
        base_url: 'https://pulp.example/served/zz-bound/',
        repository: REPOSITORY_HREF,
      }),
      distribution({
        name: 'zz-published',
        base_path: 'bp-published',
        base_url: 'https://pulp.example/served/zz-published/',
        publication: publicationRow.pulp_href,
      }),
      distribution({
        name: 'zz-versioned',
        base_path: 'bp-versioned',
        base_url: 'https://pulp.example/served/zz-versioned/',
        repository_version: `${REPOSITORY_HREF}versions/0/`,
      }),
      distribution({
        name: 'zz-foreign',
        base_path: 'zz-foreign',
        repository: OTHER_REPOSITORY_HREF,
      }),
    ]);
    servePublications([publicationRow]);
    renderDetail('distributions');

    for (const name of ['zz-bound', 'zz-published', 'zz-versioned']) {
      const row = (await screen.findByText(name)).closest('tr');
      expect(row).not.toBeNull();
      const line = within(row as HTMLElement).getByText(
        /pulp rpm remote create/,
      );
      expect(line.textContent).toBe(
        `pulp rpm remote create --name 'zz-test-rpm' --url 'https://pulp.example/served/${name}/'`,
      );
    }
    expect(screen.queryByText('zz-foreign')).toBeNull();
  });

  it('shows the list error when the distributions could not be loaded', async () => {
    serveRepository();
    server.use(
      http.get(`*${API}/distributions/rpm/rpm/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    servePublications([]);
    renderDetail('distributions');

    expect(
      await screen.findByText(/Distributions could not be displayed/),
    ).toBeInTheDocument();
  });
});
