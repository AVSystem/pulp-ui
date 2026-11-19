import { statusRead } from '@pulp-ui/sdk/core/status';
import { tasksRead } from '@pulp-ui/sdk/core/tasks';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';

// The configuration is loaded by the test setup before the first test runs.
let defaultBase: string;
beforeAll(() => {
  defaultBase = config.API_BASE_PATH;
});

afterEach(() => {
  config.API_BASE_PATH = defaultBase;
});

// Records every request to the paths it is given and answers each with an
// empty object.
function recordHits(...paths: string[]) {
  const hits: string[] = [];
  server.use(
    ...paths.map((path) =>
      http.get(path, ({ request }) => {
        hits.push(request.url);
        return HttpResponse.json({});
      }),
    ),
  );
  return hits;
}

describe('the sdk request policy', () => {
  it('sends a static-path call to the default base', async () => {
    const hits = recordHits('*/pulp/api/v3/status/');

    await statusRead();

    expect(hits).toHaveLength(1);
  });

  it('sends an href-path call to the default base on the same origin', async () => {
    const hits = recordHits('*/pulp/api/v3/tasks/0001/');

    await tasksRead('/pulp/api/v3/tasks/0001/');

    expect(hits).toHaveLength(1);
    expect(new URL(hits[0] ?? '').origin).toBe(window.location.origin);
  });

  it('sends a static-path call to the configured base', async () => {
    config.API_BASE_PATH = '/other/api/';
    const moved = recordHits('*/other/api/status/');
    const original = recordHits('*/pulp/api/v3/status/');

    await statusRead();

    expect(moved).toHaveLength(1);
    expect(original).toHaveLength(0);
  });

  it('sends an href-path call to the configured base on the same origin', async () => {
    config.API_BASE_PATH = '/other/api/';
    const moved = recordHits('*/other/api/tasks/0001/');
    const original = recordHits('*/pulp/api/v3/tasks/0001/');

    await tasksRead('/pulp/api/v3/tasks/0001/');

    expect(moved).toHaveLength(1);
    expect(original).toHaveLength(0);
    expect(new URL(moved[0] ?? '').origin).toBe(window.location.origin);
  });

  it('refuses a call whose href leaves the API and never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(tasksRead('evil.example/x/')).rejects.toThrow(
      /leaves the API/,
    );
    await expect(tasksRead('//evil.example/x/')).rejects.toThrow(
      /leaves the API/,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
