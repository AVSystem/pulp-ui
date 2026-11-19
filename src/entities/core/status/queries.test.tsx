import { screen } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from 'src/test-utils/render';
import { server } from 'src/test-utils/server';
import { statusKeys, useStatus } from './queries';

function Probe() {
  const status = useStatus();

  if (status.isPending) {
    return <p>loading</p>;
  }
  if (status.isError) {
    return (
      <>
        <p data-testid='error'>{status.error.name}</p>
        <button type='button' onClick={() => status.refetch()}>
          Retry
        </button>
      </>
    );
  }
  return <pre data-testid='data'>{JSON.stringify(status.data)}</pre>;
}

const read = () => JSON.parse(screen.getByTestId('data').textContent ?? '');

describe('Integration: useStatus', { tags: ['integration'] }, () => {
  it('has a key below the status object of the core plugin', () => {
    expect(statusKeys.all).toStrictEqual(['pulp', 'core', 'status']);
  });

  it('returns the health-only answer a visitor gets', async () => {
    const anonymous = { database_connection: { connected: true } };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(anonymous)),
    );

    renderWithProviders(<Probe />);

    expect(await screen.findByTestId('data')).toBeInTheDocument();
    expect(read()).toStrictEqual(anonymous);
  });

  it('returns the versions a signed-in account gets', async () => {
    const answer = {
      versions: [{ component: 'core', version: '3.112.0' }],
      database_connection: { connected: true },
      redis_connection: { connected: true },
    };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(answer)),
    );

    renderWithProviders(<Probe />, { signedIn: true });

    expect(await screen.findByTestId('data')).toBeInTheDocument();
    expect(read()).toStrictEqual(answer);
  });

  it('returns the full answer of an administrator', async () => {
    const answer = {
      versions: [{ component: 'core', version: '3.112.0' }],
      online_workers: [
        { pulp_href: '/pulp/api/v3/workers/1/', name: '1@worker' },
      ],
      online_api_apps: [],
      online_content_apps: [],
      database_connection: { connected: true },
      storage: { total: 10, used: 4, free: 6 },
      content_settings: { content_path_prefix: '/pulp/content/' },
      domain_enabled: false,
    };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(answer)),
    );

    renderWithProviders(<Probe />, { signedIn: true });

    expect(await screen.findByTestId('data')).toBeInTheDocument();
    expect(read()).toStrictEqual(answer);
  });

  it('shows a ResponseShapeError for an answer of the wrong shape and reads again on retry', async () => {
    let requests = 0;
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        requests += 1;
        return HttpResponse.json({ versions: [{ version: '1' }] });
      }),
    );

    const { user } = renderWithProviders(<Probe />);

    expect(await screen.findByTestId('error')).toHaveTextContent(
      'ResponseShapeError',
    );
    expect(requests).toBe(1);

    const corrected = { versions: [{ component: 'core', version: '1' }] };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(corrected)),
    );
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByTestId('data')).toBeInTheDocument();
    expect(read()).toStrictEqual(corrected);
  });
});
