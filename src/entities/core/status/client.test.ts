import { HttpResponse, delay, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import { server } from 'src/test-utils/server';
import { StatusClient } from './client';

describe('Integration: StatusClient', { tags: ['integration'] }, () => {
  const signedIn = {
    versions: [{ component: 'core', version: '3.112.0' }],
    database_connection: { connected: true },
    redis_connection: { connected: true },
  };

  it('retrieves the status a signed-in account gets', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(signedIn)),
    );

    await expect(StatusClient.retrieve()).resolves.toStrictEqual(signedIn);
  });

  it('retrieves the health-only status a visitor gets', async () => {
    const anonymous = { database_connection: { connected: true } };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(anonymous)),
    );

    await expect(StatusClient.retrieve()).resolves.toStrictEqual(anonymous);
  });

  it('retrieves the full status of an administrator with relative hrefs', async () => {
    const full = {
      ...signedIn,
      online_workers: [
        { pulp_href: '/pulp/api/v3/workers/1/', name: '1@worker' },
      ],
      online_api_apps: [],
      online_content_apps: [],
      storage: { total: 10, used: 4, free: 6 },
      content_settings: { content_path_prefix: '/pulp/content/' },
      domain_enabled: false,
    };
    server.use(
      http.get('*/pulp/api/v3/status/', () => HttpResponse.json(full)),
    );

    await expect(StatusClient.retrieve()).resolves.toStrictEqual(full);
  });

  it('rejects with the status on a non-2xx response', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Service unavailable' }, { status: 503 }),
      ),
    );

    await expect(StatusClient.retrieve()).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects with a ResponseShapeError when a 2xx answer has the wrong shape', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ versions: [{ version: '1' }] }),
      ),
    );

    await expect(StatusClient.retrieve()).rejects.toBeInstanceOf(
      ResponseShapeError,
    );
  });

  it('cancels the request when the signal is aborted', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', async () => {
        await delay(200);
        return HttpResponse.json(signedIn);
      }),
    );
    const controller = new AbortController();

    const pending = StatusClient.retrieve({ signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });
});
