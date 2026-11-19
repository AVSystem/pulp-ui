import { loginRead } from '@pulp-ui/sdk/core/login';
import { statusRead } from '@pulp-ui/sdk/core/status';
import { tasksDelete, tasksRead } from '@pulp-ui/sdk/core/tasks';
import { HttpResponse, http } from 'msw';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PulpAPI } from 'src/api/pulp';
import type * as RequestPolicy from 'src/session/request-policy';
import { handleFailure, prepareRequest } from 'src/session/request-policy';
import {
  SessionSuspendedError,
  getSnapshot,
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
} from 'src/session/session-events';
import { server } from 'src/test-utils/server';
import { config } from 'src/ui-config';
import {
  isSessionEnd,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

// The real policy, with every call recorded so a test can read what the two
// clients handed to it.
vi.mock('src/session/request-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof RequestPolicy>();
  return {
    ...actual,
    prepareRequest: vi.fn(actual.prepareRequest),
    handleFailure: vi.fn(actual.handleFailure),
  };
});

// The configuration is loaded by the test setup before the first test runs.
let defaultBase: string;
beforeAll(() => {
  defaultBase = config.API_BASE_PATH;
});

afterEach(() => {
  config.API_BASE_PATH = defaultBase;
  resetSessionEvents();
  vi.mocked(prepareRequest).mockClear();
  vi.mocked(handleFailure).mockClear();
  document.cookie = 'csrftoken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

class ExampleAPI extends PulpAPI {
  read() {
    return this.http.get('examples/');
  }
}

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

describe('the sdk and the session', () => {
  const refuse = (path: string, status: number, detail = 'No.') =>
    server.use(http.get(path, () => HttpResponse.json({ detail }, { status })));

  it('sends a CSRF token on an unsafe call and none on a safe one', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        seen['GET'] = request.headers.get('x-csrftoken');
        return HttpResponse.json({});
      }),
      http.delete('*/pulp/api/v3/tasks/0001/', ({ request }) => {
        seen['DELETE'] = request.headers.get('x-csrftoken');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    document.cookie = 'csrftoken=token-a; path=/';

    await statusRead();
    await tasksDelete('/pulp/api/v3/tasks/0001/');

    expect(seen).toEqual({ GET: null, DELETE: 'token-a' });
  });

  it('sends cookies on every call', async () => {
    let credentials: RequestCredentials | undefined;
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({});
      }),
    );

    await statusRead();

    expect(credentials).toBe('include');
  });

  it('holds back a call while the session has ended, except the sign-in calls', async () => {
    let sent = 0;
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        sent += 1;
        return HttpResponse.json({});
      }),
      http.get('*/pulp/api/v3/login/', () => {
        sent += 1;
        return HttpResponse.json({ username: 'zoe' });
      }),
    );
    setSignedIn(true);
    reportUnauthorized('tab-return');

    await expect(statusRead()).rejects.toBeInstanceOf(SessionSuspendedError);
    await loginRead();

    expect(sent).toBe(1);
  });

  it('reports a 401 of a signed-in user and still rejects with the answer', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/status/', 401);

    const error = await statusRead().catch((e) => e);

    expect(error.response.status).toBe(401);
    expect(isSessionEnd(error)).toBe(true);
    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
  });

  it('does not report the 401 of the login call', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/login/', 401);

    await expect(loginRead()).rejects.toMatchObject({
      response: { status: 401 },
    });

    expect(getSnapshot().ended).toBe(false);
  });

  it('leaves a 403 a refusal with the server detail when who-is-signed-in answers', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/status/', 403, 'Forbidden here.');
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ username: 'zoe' }),
      ),
    );

    const error = await statusRead().catch((e) => e);

    expect(requestErrorStatus(error)).toBe(403);
    expect(isSessionEnd(error)).toBe(false);
    expect(requestErrorDetail(error)).toBe('Forbidden here.');
    expect(getSnapshot().ended).toBe(false);
  });

  // A request that has reached the server and is answered only when the test
  // says so, so the session can be resumed in between.
  function holdAnswer(path: string, status: number) {
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    server.use(
      http.get(path, async () => {
        reached();
        await gate;
        return HttpResponse.json({ detail: 'No.' }, { status });
      }),
    );
    return { arrived, release };
  }

  it('ignores the 401 of a call sent before the session was resumed', async () => {
    setSignedIn(true);
    const held = holdAnswer('*/pulp/api/v3/status/', 401);
    const pending = statusRead().catch((e) => e);
    await held.arrived;

    resume();
    held.release();
    const error = await pending;

    expect(requestErrorStatus(error)).toBe(401);
    expect(getSnapshot()).toEqual({ ended: false, fromRequest: false });
  });

  it('acts on the 401 of a call sent after the session was resumed', async () => {
    setSignedIn(true);
    resume();
    const held = holdAnswer('*/pulp/api/v3/status/', 401);
    const pending = statusRead().catch((e) => e);
    await held.arrived;

    held.release();
    await pending;

    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
  });

  it('asks who is signed in nothing for a 403 of a call sent before the session was resumed', async () => {
    setSignedIn(true);
    const held = holdAnswer('*/pulp/api/v3/status/', 403);
    let checks = 0;
    server.use(
      http.get('*/pulp/api/v3/login/', () => {
        checks += 1;
        return HttpResponse.json({ detail: 'No.' }, { status: 401 });
      }),
    );
    const pending = statusRead().catch((e) => e);
    await held.arrived;

    resume();
    held.release();
    const error = await pending;

    expect(requestErrorStatus(error)).toBe(403);
    expect(checks).toBe(0);
    expect(getSnapshot().ended).toBe(false);
  });

  it('shares one who-is-signed-in request between an sdk refusal and a legacy refusal', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/status/', 403);
    refuse('*/pulp/api/v3/examples/', 403);
    const seen: string[] = [];
    server.use(
      http.get('*/pulp/api/v3/login/', () => {
        seen.push('GET');
        return HttpResponse.json({ detail: 'No.' }, { status: 401 });
      }),
    );

    const errors = await Promise.all([
      statusRead().catch((e) => e),
      new ExampleAPI().read().catch((e) => e),
    ]);

    expect(seen).toEqual(['GET']);
    expect(errors.map(isSessionEnd)).toEqual([true, true]);
    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
  });

  it('leaves both refusals alone when the shared check answers', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/status/', 403, 'Nope.');
    refuse('*/pulp/api/v3/examples/', 403, 'Nope.');
    server.use(
      http.get('*/pulp/api/v3/login/', () =>
        HttpResponse.json({ username: 'zoe' }),
      ),
    );

    const errors = await Promise.all([
      statusRead().catch((e) => e),
      new ExampleAPI().read().catch((e) => e),
    ]);

    expect(errors.map(isSessionEnd)).toEqual([false, false]);
    expect(errors.map(requestErrorDetail)).toEqual(['Nope.', 'Nope.']);
  });

  it('hands the context prepareRequest returned to handleFailure unchanged, for both clients', async () => {
    setSignedIn(true);
    refuse('*/pulp/api/v3/status/', 500);
    refuse('*/pulp/api/v3/examples/', 500);

    await statusRead().catch((e) => e);
    await new ExampleAPI().read().catch((e) => e);

    const prepared = vi.mocked(prepareRequest).mock.results;
    const failures = vi.mocked(handleFailure).mock.calls;
    expect(prepared).toHaveLength(2);
    expect(failures).toHaveLength(2);
    expect(failures[0]?.[4]).toBe(prepared[0]?.value);
    expect(failures[1]?.[4]).toBe(prepared[1]?.value);
    expect(prepared[0]?.value).not.toBe(prepared[1]?.value);
  });
});
