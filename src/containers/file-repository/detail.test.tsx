import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AppContextProvider } from 'src/app-context';
import { Paths } from 'src/paths';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import FileRepositoryDetail from './detail';

const API = '/pulp/api/v3';

describe('File repository details', () => {
  it('shows no last-updated-from-registry line even when the item carries a last sync task', async () => {
    const row = repository({
      name: 'zz-test-file',
      remote: null,
      last_sync_task: task({
        state: 'completed',
        finished_at: '2000-01-02T00:00:00.000000Z',
      }),
    });
    server.use(
      listOf(`${API}/repositories/file/file/`, [row], {
        matching: (r, query) => r.name === query.get('name'),
      }).handler,
      listOf(`${API}/distributions/file/file/`, []).handler,
      listOf(`${API}/publications/file/file/`, []).handler,
    );

    renderWithProviders(
      <AppContextProvider>
        <Routes>
          <Route
            path={Paths.file.repository.detail}
            element={<FileRepositoryDetail />}
          />
        </Routes>
      </AppContextProvider>,
      { route: '/file/repositories/detail/zz-test-file?tab=details' },
    );

    expect(
      await screen.findByRole('heading', { name: 'zz-test-file' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Last updated from registry/)).toBeNull();
  });
});
