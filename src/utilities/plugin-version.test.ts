import type { QueryClient } from '@tanstack/react-query';
import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { StatusClient } from 'src/entities/core/status/client';
import { statusKeys } from 'src/entities/core/status/queries';
import { createTestQueryClient } from 'src/test-utils/query';
import { server } from 'src/test-utils/server';
import { plugin_versions } from './plugin-version';

// Each test reads through its own client, so no test sees what another cached.
const read = (queryClient: QueryClient, fresh = false) =>
  plugin_versions({ fresh, queryClient });

// Answers status/ with the given statuses in turn and counts the requests.
function answerStatus(...answers: number[]) {
  const counter = { requests: 0 };
  server.use(
    http.get('*/pulp/api/v3/status/', () => {
      const answer = answers[Math.min(counter.requests, answers.length - 1)];
      counter.requests += 1;
      if (answer !== 200) {
        return HttpResponse.json({ detail: 'Failed.' }, { status: answer });
      }
      return HttpResponse.json({
        versions: [{ component: 'core', version: `3.${counter.requests}.0` }],
      });
    }),
  );
  return counter;
}

describe('plugin versions', () => {
  const client = () => createTestQueryClient();

  it('asks the server again after a failed answer instead of repeating the failure', async () => {
    const counter = answerStatus(500, 200);

    const queryClient = client();
    await expect(read(queryClient)).rejects.toBeTruthy();
    const versions = await read(queryClient);

    expect(counter.requests).toBe(2);
    expect(versions).toEqual([{ name: 'core', version: '3.2.0' }]);
  });

  it('sends one request for callers that ask at the same time', async () => {
    const counter = answerStatus(200);

    const queryClient = client();
    const [first, second] = await Promise.all([
      read(queryClient),
      read(queryClient),
    ]);

    expect(counter.requests).toBe(1);
    expect(second).toEqual(first);
  });

  it('serves a successful answer from the cache', async () => {
    const counter = answerStatus(200);

    const queryClient = client();
    await read(queryClient);
    await read(queryClient);

    expect(counter.requests).toBe(1);
  });

  it('sends a new request when asked for a fresh answer although a successful one is cached', async () => {
    const counter = answerStatus(200);

    const queryClient = client();
    await read(queryClient);
    const versions = await read(queryClient, true);

    expect(counter.requests).toBe(2);
    expect(versions).toEqual([{ name: 'core', version: '3.2.0' }]);
  });

  it('rejects with a readable error when the answer lists no plugins', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({
          database_connection: { connected: true },
          redis_connection: { connected: true },
        }),
      ),
    );

    await expect(read(client())).rejects.toThrow(
      'The status answer lists no plugins.',
    );
  });

  it('asks the server again after an answer that listed no plugins', async () => {
    let requests = 0;
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        requests += 1;
        return requests === 1
          ? HttpResponse.json({ database_connection: { connected: true } })
          : HttpResponse.json({
              versions: [{ component: 'core', version: '3.0.0' }],
            });
      }),
    );

    const queryClient = client();
    await expect(read(queryClient)).rejects.toBeInstanceOf(Error);
    await expect(read(queryClient)).resolves.toEqual([
      { name: 'core', version: '3.0.0' },
    ]);
    expect(requests).toBe(2);
  });

  it('shares the answer with a status read of the same client', async () => {
    const counter = answerStatus(200);
    const queryClient = client();

    await queryClient.fetchQuery({
      queryKey: statusKeys.all,
      queryFn: ({ signal }) => StatusClient.retrieve({ signal }),
    });
    await read(queryClient);

    expect(counter.requests).toBe(1);
  });
});
