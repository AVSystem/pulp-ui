import { screen, within } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, repository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import FileRepositoryList from './list';

const API = '/pulp/api/v3';

function renderList(route: string, names: string[]) {
  const rows = names.map((name) => repository({ name }));
  const { handler, queries } = listOf(`${API}/repositories/file/file/`, rows);
  server.use(
    handler,
    listOf(`${API}/remotes/file/file/`, []).handler,
    listOf(`${API}/distributions/file/file/`, []).handler,
  );

  renderWithProviders(
    <AppContextProvider>
      <Routes>
        <Route
          path={Paths.file.repository.list}
          element={<FileRepositoryList />}
        />
      </Routes>
    </AppContextProvider>,
    { route },
  );
  return { queries };
}

describe('file repository list', () => {
  it('opens sorted by name when the address carries no sort', async () => {
    const { queries } = renderList('/file/repositories', ['alpha', 'beta']);

    await screen.findByText('alpha');

    expect(queries[0]?.get('ordering')).toBe('name');
  });

  it('keeps the sort of the address instead of the default', async () => {
    const { queries } = renderList('/file/repositories?sort=-pulp_created', [
      'alpha',
      'beta',
    ]);

    await screen.findByText('alpha');

    expect(queries[0]?.get('ordering')).toBe('-pulp_created');
  });

  it('shows the rows in the order the server answered, without sorting them again', async () => {
    renderList('/file/repositories', ['zeta', 'alpha', 'mid']);

    await screen.findByText('zeta');

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent);
    expect(names).toStrictEqual(['zeta', 'alpha', 'mid']);
  });
});
