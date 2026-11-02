import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, pythonDistribution, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import PythonRepositoryDetail from './detail';

const API = '/pulp/api/v3';
const REPOSITORY_HREF = `${API}/repositories/python/python/00000000-0000-4000-8000-0000000000aa/`;

const index = repository({
  name: 'zz-test-python',
  pulp_href: REPOSITORY_HREF,
  retain_repo_versions: null,
  remote: null,
});

const served = pythonDistribution({
  name: 'zz-served',
  base_path: 'bp-served',
  repository: REPOSITORY_HREF,
});

function renderTab() {
  return renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.python.repository.detail}
          element={<PythonRepositoryDetail />}
        />
      </Routes>
    </AppContextProvider>,
    { route: '/python/repositories/detail/zz-test-python?tab=distributions' },
  );
}

describe('Python repository Distributions tab: a failed load', () => {
  it('shows the Retry of a failed distributions load and loads the page again', async () => {
    let failing = true;
    server.use(
      listOf(`${API}/repositories/python/python/`, [index], {
        matching: (r, query) => r.name === query.get('name'),
      }).handler,
      http.get(`*${API}/distributions/python/pypi/`, () =>
        failing
          ? HttpResponse.json({ detail: 'broken' }, { status: 500 })
          : HttpResponse.json({
              count: 1,
              next: null,
              previous: null,
              results: [served],
            }),
      ),
    );
    const { user } = renderTab();

    expect(
      await screen.findByText(/Distributions could not be displayed/),
    ).toBeInTheDocument();

    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('zz-served')).toBeInTheDocument();
  });
});
