import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionSuspendedError,
  getSnapshot,
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
  subscribe,
} from 'src/session/session-events';
import { server } from 'src/test-utils/server';
import { isSessionEnd } from 'src/utilities/request-error';
import { PulpAPI } from './pulp';

class ExampleAPI extends PulpAPI {
  create(name: string) {
    return this.http.post('examples/', { name });
  }

  remove() {
    return this.http.delete('examples/1/');
  }

  read() {
    return this.http.get('examples/');
  }

  login() {
    return this.http.post('login/', null);
  }

  whoami() {
    return this.http.get('login/');
  }
}

interface IRequestFacts {
  method: string;
  requestedWith: string | null;
  csrfToken: string | null;
  authorization: string | null;
  credentials: RequestCredentials;
}

// Records what the server saw of every request to the example endpoints.
function recordRequests() {
  const seen: IRequestFacts[] = [];
  const record = ({ request }: { request: Request }) => {
    seen.push({
      method: request.method,
      requestedWith: request.headers.get('x-requested-with'),
      csrfToken: request.headers.get('x-csrftoken'),
      authorization: request.headers.get('authorization'),
      credentials: request.credentials,
    });
    return HttpResponse.json({});
  };
  server.use(
    http.get('*/pulp/api/v3/examples/', record),
    http.post('*/pulp/api/v3/examples/', record),
    http.delete('*/pulp/api/v3/examples/1/', record),
  );
  return seen;
}

function setCsrfCookie(value: string) {
  document.cookie = `csrftoken=${value}; path=/`;
}

describe('api client', () => {
  afterEach(() => {
    document.cookie =
      'csrftoken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
  });

  it('every request carries X-Requested-With and sends cookies', async () => {
    const seen = recordRequests();
    const api = new ExampleAPI();

    await api.read();
    await api.create('one');
    await api.remove();

    expect(seen.map((request) => request.method)).toEqual([
      'GET',
      'POST',
      'DELETE',
    ]);
    for (const request of seen) {
      expect(request.requestedWith).toBe('XMLHttpRequest');
      expect(request.credentials).toBe('include');
    }
  });

  it('an unsafe request carries the CSRF token from the cookie as it is at request time', async () => {
    const seen = recordRequests();
    const api = new ExampleAPI();

    setCsrfCookie('token-a');
    await api.create('one');
    setCsrfCookie('token-b');
    await api.create('two');
    await api.remove();

    expect(seen.map((request) => request.csrfToken)).toEqual([
      'token-a',
      'token-b',
      'token-b',
    ]);
  });

  it('a safe request carries no CSRF token even when the cookie is set', async () => {
    const seen = recordRequests();

    setCsrfCookie('token-a');
    await new ExampleAPI().read();

    expect(seen).toHaveLength(1);
    expect(seen[0]?.csrfToken).toBeNull();
  });

  it('no CSRF header is sent while the cookie is absent', async () => {
    const seen = recordRequests();

    await new ExampleAPI().create('one');

    expect(seen).toHaveLength(1);
    expect(seen[0]?.csrfToken).toBeNull();
  });

  it('no request carries an Authorization header unless the caller sets one', async () => {
    const seen = recordRequests();
    const api = new ExampleAPI();

    setCsrfCookie('token-a');
    await api.read();
    await api.create('one');
    await api.remove();

    expect(seen).toHaveLength(3);
    for (const request of seen) {
      expect(request.authorization).toBeNull();
    }
  });

  describe('a refused request', () => {
    const refuse = (status: number) =>
      server.use(
        http.get('*/pulp/api/v3/examples/', () =>
          HttpResponse.json({ detail: 'No.' }, { status }),
        ),
        http.post('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ detail: 'No.' }, { status }),
        ),
        http.get('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ detail: 'No.' }, { status }),
        ),
      );

    afterEach(() => {
      resetSessionEvents();
    });

    it('a 401 of a call that is not the login tells the session once and still rejects with the original error', async () => {
      setSignedIn(true);
      refuse(401);
      const listener = vi.fn();
      subscribe(listener);

      await expect(new ExampleAPI().read()).rejects.toMatchObject({
        response: { status: 401, data: { detail: 'No.' } },
      });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('a 401 of the login call and of the who-is-signed-in call tells nobody', async () => {
      setSignedIn(true);
      refuse(401);
      const listener = vi.fn();
      subscribe(listener);
      const api = new ExampleAPI();

      await expect(api.login()).rejects.toMatchObject({
        response: { status: 401 },
      });
      await expect(api.whoami()).rejects.toMatchObject({
        response: { status: 401 },
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('a 403 while the session is alive and a 500 tell nobody', async () => {
      setSignedIn(true);
      const listener = vi.fn();
      subscribe(listener);

      refuse(403);
      server.use(
        http.get('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ username: 'zoe' }),
        ),
      );
      await expect(new ExampleAPI().read()).rejects.toBeDefined();
      refuse(500);
      await expect(new ExampleAPI().read()).rejects.toBeDefined();

      expect(listener).not.toHaveBeenCalled();
    });

    it('is sent once and never repeated by the client', async () => {
      setSignedIn(true);
      let requests = 0;
      server.use(
        http.get('*/pulp/api/v3/examples/', () => {
          requests += 1;
          return HttpResponse.json({ detail: 'No.' }, { status: 401 });
        }),
      );

      await expect(new ExampleAPI().read()).rejects.toBeDefined();
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(requests).toBe(1);
    });
  });

  // A backend that answers an ended session with 403 instead of 401 cannot be
  // told from a real refusal by the status alone, so one who-is-signed-in
  // request decides.
  describe('a 403 of a signed-in user', () => {
    const refuseExamples = () =>
      server.use(
        http.get('*/pulp/api/v3/examples/', () =>
          HttpResponse.json({ detail: 'Forbidden.' }, { status: 403 }),
        ),
      );
    const whoamiAnswers = (status: number, seen?: string[]) =>
      server.use(
        http.get('*/pulp/api/v3/login/', ({ request }) => {
          seen?.push(request.method);
          return status === 200
            ? HttpResponse.json({ username: 'zoe' })
            : HttpResponse.json({ detail: 'No.' }, { status });
        }),
      );

    afterEach(() => {
      resetSessionEvents();
    });

    it('reaches the caller unchanged and opens nothing when the session is alive', async () => {
      setSignedIn(true);
      refuseExamples();
      whoamiAnswers(200);
      const listener = vi.fn();
      subscribe(listener);

      const error = await new ExampleAPI().read().catch((e) => e);

      expect(error.response.status).toBe(403);
      expect(error.response.data).toEqual({ detail: 'Forbidden.' });
      expect(isSessionEnd(error)).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it.each([401, 403])(
      'ends the session, with the request note, when who-is-signed-in answers %i',
      async (status) => {
        setSignedIn(true);
        refuseExamples();
        whoamiAnswers(status);

        const error = await new ExampleAPI().read().catch((e) => e);

        expect(isSessionEnd(error)).toBe(true);
        expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
      },
    );

    it('keeps the 403 a refusal when who-is-signed-in itself fails with a 500 or a lost connection', async () => {
      setSignedIn(true);
      refuseExamples();
      const listener = vi.fn();
      subscribe(listener);

      whoamiAnswers(500);
      const first = await new ExampleAPI().read().catch((e) => e);
      server.use(http.get('*/pulp/api/v3/login/', () => HttpResponse.error()));
      const second = await new ExampleAPI().read().catch((e) => e);

      expect(isSessionEnd(first)).toBe(false);
      expect(isSessionEnd(second)).toBe(false);
      expect(listener).not.toHaveBeenCalled();
    });

    it('sends one who-is-signed-in request for concurrent refusals', async () => {
      setSignedIn(true);
      refuseExamples();
      const seen: string[] = [];
      whoamiAnswers(401, seen);
      const api = new ExampleAPI();

      const errors = await Promise.all([
        api.read().catch((e) => e),
        api.read().catch((e) => e),
        api.read().catch((e) => e),
      ]);

      expect(seen).toEqual(['GET']);
      expect(errors.map(isSessionEnd)).toEqual([true, true, true]);
    });

    it('asks again for a later refusal once the first check has answered', async () => {
      setSignedIn(true);
      refuseExamples();
      const seen: string[] = [];
      whoamiAnswers(200, seen);
      const api = new ExampleAPI();

      await api.read().catch((e) => e);
      await api.read().catch((e) => e);

      expect(seen).toEqual(['GET', 'GET']);
    });

    it('sends no who-is-signed-in request when nobody is signed in', async () => {
      refuseExamples();
      const seen: string[] = [];
      whoamiAnswers(401, seen);

      const error = await new ExampleAPI().read().catch((e) => e);

      expect(error.response.status).toBe(403);
      expect(isSessionEnd(error)).toBe(false);
      expect(seen).toEqual([]);
    });

    it('sends no who-is-signed-in request for a 403 of the login call itself', async () => {
      setSignedIn(true);
      const seen: string[] = [];
      server.use(
        http.post('*/pulp/api/v3/login/', () =>
          HttpResponse.json({ detail: 'No.' }, { status: 403 }),
        ),
        http.get('*/pulp/api/v3/login/', ({ request }) => {
          seen.push(request.method);
          return HttpResponse.json({ username: 'zoe' });
        }),
      );

      await new ExampleAPI().login().catch((e) => e);

      expect(seen).toEqual([]);
    });
  });

  describe('while the session has ended', () => {
    afterEach(() => {
      resetSessionEvents();
    });

    const endSession = () => {
      setSignedIn(true);
      reportUnauthorized('tab-return');
    };

    it('a request other than a sign-in call is held back and never leaves the browser', async () => {
      const seen = recordRequests();
      endSession();

      await expect(new ExampleAPI().read()).rejects.toBeInstanceOf(
        SessionSuspendedError,
      );
      await expect(new ExampleAPI().create('one')).rejects.toBeInstanceOf(
        SessionSuspendedError,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(seen).toHaveLength(0);
    });

    it('the sign-in calls still go out', async () => {
      let sent = 0;
      server.use(
        http.post('*/pulp/api/v3/login/', () => {
          sent += 1;
          return HttpResponse.json({});
        }),
        http.get('*/pulp/api/v3/login/', () => {
          sent += 1;
          return HttpResponse.json({});
        }),
      );
      endSession();
      const api = new ExampleAPI();

      await api.login();
      await api.whoami();

      expect(sent).toBe(2);
    });

    it('requests go out again after the session resumes', async () => {
      const seen = recordRequests();
      endSession();
      await expect(new ExampleAPI().read()).rejects.toBeDefined();

      resume();
      await new ExampleAPI().read();

      expect(seen).toHaveLength(1);
    });

    it('a held-back request does not tell the session about a refusal', async () => {
      endSession();
      const listener = vi.fn();
      subscribe(listener);

      await expect(new ExampleAPI().read()).rejects.toBeDefined();

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
