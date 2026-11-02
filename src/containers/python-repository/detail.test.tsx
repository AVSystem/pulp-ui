import { screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { distribution, listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonRepositoryDetail from './detail';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/python/python/00000000-0000-4000-8000-0000000000aa/`;
const OTHER_REPOSITORY_HREF = `${API}/repositories/python/python/00000000-0000-4000-8000-0000000000bb/`;

const index = repository({
  name: 'zz-test-python',
  pulp_href: REPOSITORY_HREF,
  retain_repo_versions: null,
  remote: null,
});

// Every distribution the page reads comes from the Python distribution
// endpoint, filtered by repository the way the server does.
function serveDistributions(rows: ReturnType<typeof distribution>[]) {
  server.use(
    listOf(`${API}/distributions/python/pypi/`, rows, {
      matching: (row, query) =>
        query.has('repository')
          ? row.repository === query.get('repository')
          : true,
    }).handler,
  );
}

function serveRepository(row = index) {
  server.use(
    listOf(`${API}/repositories/python/python/`, [row], {
      matching: (r, query) => r.name === query.get('name'),
    }).handler,
  );
}

function renderDetail(tab: 'details' | 'distributions' = 'details') {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.python.repository.detail}
          element={<PythonRepositoryDetail />}
        />
      </Routes>
    </AppContextProvider>,
    { route: `/python/repositories/detail/zz-test-python?tab=${tab}` },
  );
}

describe('Python repository details', () => {
  it('shows the base_url the server reports for each distribution, never a URL built from the base path', async () => {
    serveRepository();
    serveDistributions([
      distribution({
        name: 'zz-first',
        base_path: 'zz-first',
        base_url: 'https://pulp.example/mirror-one/zz-first/',
        repository: REPOSITORY_HREF,
      }),
      distribution({
        name: 'zz-second',
        base_path: 'zz-second',
        base_url: 'https://pulp.example/mirror-two/other/',
        repository: REPOSITORY_HREF,
      }),
      distribution({
        name: 'zz-foreign',
        base_path: 'zz-foreign',
        base_url: 'https://pulp.example/foreign/',
        repository: OTHER_REPOSITORY_HREF,
      }),
    ]);
    renderDetail();

    expect(
      await screen.findByText('https://pulp.example/mirror-one/zz-first/'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('https://pulp.example/mirror-two/other/'),
    ).toBeInTheDocument();
    expect(screen.queryByText('https://pulp.example/foreign/')).toBeNull();
    expect(screen.queryByText(/\/pulp\/content\/zz-/)).toBeNull();
    // Python distributions serve the repository directly
    expect(screen.queryByText(/Not served/)).toBeNull();
  });

  it('shows why the distributions are missing when they could not be loaded, instead of "None"', async () => {
    serveRepository();
    server.use(
      http.get(`*${API}/distributions/python/pypi/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderDetail();

    expect(
      await screen.findByText(/Distributions could not be loaded/),
    ).toBeInTheDocument();
  });
});

describe('Python repository Distributions tab', () => {
  it('lists every distribution bound to the repository with the server URL and a pip line using it', async () => {
    serveRepository();
    serveDistributions([
      distribution({
        name: 'zz-one',
        base_path: 'bp-one',
        base_url: 'https://pulp.example/served/zz-one/',
        repository: REPOSITORY_HREF,
      }),
      distribution({
        name: 'zz-two',
        base_path: 'bp-two',
        base_url: 'https://pulp.example/served/zz-two/',
        repository: REPOSITORY_HREF,
      }),
      distribution({
        name: 'zz-foreign',
        base_path: 'zz-foreign',
        repository: OTHER_REPOSITORY_HREF,
      }),
    ]);
    renderDetail('distributions');

    for (const name of ['zz-one', 'zz-two']) {
      const row = (await screen.findByText(name)).closest('tr');
      expect(row).not.toBeNull();
      const line = within(row as HTMLElement).getByText(/pip install/);
      expect(line.textContent).toBe(
        `pip install --index-url https://pulp.example/served/${name}/simple/ <package>`,
      );
    }
    expect(screen.queryByText('zz-foreign')).toBeNull();
  });

  it('shows the list error when the distributions could not be loaded', async () => {
    serveRepository();
    server.use(
      http.get(`*${API}/distributions/python/pypi/`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );
    renderDetail('distributions');

    expect(
      await screen.findByText(/Distributions could not be displayed/),
    ).toBeInTheDocument();
  });
});
