import { Td, Tr } from '@patternfly/react-table';
import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PulpAPI } from '../api/pulp';
import { listOf } from '../test-utils/pulp';
import { renderWithProviders } from '../test-utils/render';
import { server } from '../test-utils/server';
import { DetailList } from './detail-list';

const THINGS = '/pulp/api/v3/things/';

interface IThing {
  name: string;
}

const things = new PulpAPI();

function renderList({ strict = false }: { strict?: boolean } = {}) {
  const addAlert = vi.fn();
  const list = (
    <DetailList<IThing>
      actionContext={{ addAlert, hasPermission: () => true, query: vi.fn() }}
      defaultPageSize={10}
      errorTitle='Things could not be displayed.'
      noDataDescription='Things appear once they are created.'
      noDataTitle='No things yet'
      query={({ params }) => things.list('things/', params)}
      renderTableRow={(item) => (
        <Tr key={item.name}>
          <Td>{item.name}</Td>
        </Tr>
      )}
      sortHeaders={[{ title: 'Name', type: 'alpha', id: 'name' }]}
      title='Things'
    />
  );
  return {
    addAlert,
    ...renderWithProviders(strict ? <StrictMode>{list}</StrictMode> : list),
  };
}

const rows = (...names: string[]) => names.map((name) => ({ name }));

const failing = (status: number, statusText: string) =>
  http.get(`*${THINGS}`, () =>
    HttpResponse.json({ detail: 'no' }, { status, statusText }),
  );

describe('a list in a detail tab whose load fails', () => {
  it('shows the error state with Retry and raises no alert, for a network error', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { addAlert } = renderList();

    expect(
      await screen.findByRole('heading', {
        name: 'Things could not be displayed.',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByText('No things yet')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('shows the status of a failed answer', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { addAlert } = renderList();

    expect(
      await screen.findByText('Error 503 - Service Unavailable'),
    ).toBeInTheDocument();
    expect(addAlert).not.toHaveBeenCalled();
  });

  it('keeps the sign-in link for a 401', async () => {
    server.use(failing(401, 'Unauthorized'));
    renderList();

    expect(await screen.findByText(/Error 401 - /)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Login' })).toBeInTheDocument();
  });

  it('shows the rows once Retry finds the API again', async () => {
    server.use(http.get(`*${THINGS}`, () => HttpResponse.error()));
    const { user } = renderList();
    await screen.findByRole('button', { name: 'Retry' });

    server.use(listOf(THINGS, rows('alpha', 'beta')).handler);
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('replaces the message when Retry fails again', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { user } = renderList();
    await screen.findByText(/Error 503/);

    server.use(failing(502, 'Bad Gateway'));
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Error 502/)).toBeInTheDocument();
    expect(screen.queryByText(/Error 503/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('shows one error state under StrictMode', async () => {
    server.use(failing(503, 'Service Unavailable'));
    const { addAlert } = renderList({ strict: true });

    expect(await screen.findByText(/Error 503/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    expect(addAlert).not.toHaveBeenCalled();
  });
});

describe('a list in a detail tab whose load succeeds', () => {
  it('shows the normal empty state for an empty list', async () => {
    server.use(listOf(THINGS, []).handler);
    renderList();

    expect(await screen.findByText('No things yet')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
  });

  it('shows the rows', async () => {
    server.use(listOf(THINGS, rows('alpha')).handler);
    renderList();

    expect(await screen.findByText('alpha')).toBeInTheDocument();
  });
});
