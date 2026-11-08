import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { server } from 'src/test-utils/server';
import { plugin_versions } from './plugin-version';

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
  it('asks the server again after a failed answer instead of repeating the failure', async () => {
    const counter = answerStatus(500, 200);

    await expect(plugin_versions()).rejects.toBeTruthy();
    const versions = await plugin_versions();

    expect(counter.requests).toBe(2);
    expect(versions).toEqual([{ name: 'core', version: '3.2.0' }]);
  });

  it('sends one request for callers that ask at the same time', async () => {
    const counter = answerStatus(200);

    const [first, second] = await Promise.all([
      plugin_versions(),
      plugin_versions(),
    ]);

    expect(counter.requests).toBe(1);
    expect(second).toEqual(first);
  });

  it('serves a successful answer from the cache', async () => {
    const counter = answerStatus(200);

    await plugin_versions();
    await plugin_versions();

    expect(counter.requests).toBe(1);
  });

  it('sends a new request when asked for a fresh answer although a successful one is cached', async () => {
    const counter = answerStatus(200);

    await plugin_versions();
    const versions = await plugin_versions({ fresh: true });

    expect(counter.requests).toBe(2);
    expect(versions).toEqual([{ name: 'core', version: '3.2.0' }]);
  });
});
