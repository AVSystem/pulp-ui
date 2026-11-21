import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { config } from 'src/ui-config';
import {
  handleFailure,
  isLoginUrl,
  prepareRequest,
  resolveApiUrl,
} from './request-policy';
import {
  SessionSuspendedError,
  getSnapshot,
  isMarkedSessionEnd,
  reportUnauthorized,
  resetSessionEvents,
  resume,
  setSignedIn,
  subscribe,
} from './session-events';

// The configuration is loaded by the test setup before the first test runs.
let defaultBase: string;
beforeAll(() => {
  defaultBase = config.API_BASE_PATH;
});

afterEach(() => {
  config.API_BASE_PATH = defaultBase;
  resetSessionEvents();
  document.cookie = 'csrftoken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

describe('resolveApiUrl', () => {
  it('leaves a path under the configured base alone', () => {
    expect(resolveApiUrl('/pulp/api/v3/tasks/1/')).toBe(
      '/pulp/api/v3/tasks/1/',
    );
    expect(resolveApiUrl('/pulp/api/v3/status/?fields=a')).toBe(
      '/pulp/api/v3/status/?fields=a',
    );
  });

  it('collapses a leading double slash so the first path segment is never read as a host', () => {
    expect(resolveApiUrl('//pulp/api/v3/tasks/1/')).toBe(
      '/pulp/api/v3/tasks/1/',
    );
  });

  it('moves the schema root to the configured base', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(resolveApiUrl('/pulp/api/v3/status/')).toBe('/other/api/status/');
    expect(resolveApiUrl('//pulp/api/v3/tasks/0001/')).toBe(
      '/other/api/tasks/0001/',
    );
  });

  it('leaves a path that already starts with the configured base alone', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(resolveApiUrl('/other/api/tasks/0001/')).toBe(
      '/other/api/tasks/0001/',
    );
  });

  it('returns the path the parser resolved, so what is judged is what is requested', () => {
    expect(resolveApiUrl('/pulp/api/v3/login/../users/5/')).toBe(
      '/pulp/api/v3/users/5/',
    );
    expect(resolveApiUrl('/pulp/api/v3/./tasks/./1/')).toBe(
      '/pulp/api/v3/tasks/1/',
    );
    expect(resolveApiUrl('/pulp/api/v3/login/%2e%2e/users/5/?a=1')).toBe(
      '/pulp/api/v3/users/5/?a=1',
    );
  });

  it('does not take a path that only looks like a sign-in call for one', () => {
    expect(isLoginUrl(resolveApiUrl('/pulp/api/v3/login/../users/5/'))).toBe(
      false,
    );
    expect(isLoginUrl(resolveApiUrl('/pulp/api/v3/users/../login/'))).toBe(
      true,
    );
  });

  it.each([
    'https://evil.example/x',
    '//evil.example/pulp/api/v3/tasks/1/',
    '///pulp/api/v3/tasks/1/',
    '/elsewhere/',
    'pulp/api/v3/tasks/1/',
    '',
    '/pulp/api/v3/../../elsewhere/',
    '/pulp/api/v3/%2e%2e/%2e%2e/elsewhere/',
    '/pulp/api/v3',
  ])('refuses %j because it leaves the API', (url) => {
    expect(() => resolveApiUrl(url)).toThrow(/leaves the API/);
  });

  it('refuses the schema root once the base moved away from it', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(() => resolveApiUrl('/pulp/elsewhere/')).toThrow(/leaves the API/);
  });
});

describe('isLoginUrl', () => {
  it.each([
    'login/',
    'login/?x=1',
    '/pulp/api/v3/login/',
    '//pulp/api/v3/login/',
  ])('recognises %j', (url) => {
    expect(isLoginUrl(url)).toBe(true);
  });

  it('recognises the login call under a moved base', () => {
    config.API_BASE_PATH = '/other/api/';

    expect(isLoginUrl('/other/api/login/')).toBe(true);
    expect(isLoginUrl('/pulp/api/v3/login/')).toBe(true);
  });

  it.each([
    'logins/',
    'tasks/login/',
    '/pulp/api/v3/tasks/',
    '/pulp/api/v3/status/',
    '',
  ])('does not recognise %j', (url) => {
    expect(isLoginUrl(url)).toBe(false);
  });
});

describe('prepareRequest', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'delete'])(
    'sets the CSRF token from the cookie for %s',
    (method) => {
      document.cookie = 'csrftoken=token-a; path=/';
      const headers = new Headers();

      prepareRequest('/pulp/api/v3/things/', method, headers);

      expect(headers.get('X-CSRFToken')).toBe('token-a');
    },
  );

  it.each(['GET', 'HEAD', 'OPTIONS', 'get'])(
    'sets no CSRF token for %s',
    (method) => {
      document.cookie = 'csrftoken=token-a; path=/';
      const headers = new Headers();

      prepareRequest('/pulp/api/v3/things/', method, headers);

      expect(headers.has('X-CSRFToken')).toBe(false);
    },
  );

  it('reads the cookie at request time and sets nothing while it is absent', () => {
    const none = new Headers();
    prepareRequest('/pulp/api/v3/things/', 'POST', none);
    document.cookie = 'csrftoken=token-a; path=/';
    const first = new Headers();
    prepareRequest('/pulp/api/v3/things/', 'POST', first);
    document.cookie = 'csrftoken=token-b; path=/';
    const second = new Headers();
    prepareRequest('/pulp/api/v3/things/', 'POST', second);

    expect(none.has('X-CSRFToken')).toBe(false);
    expect(first.get('X-CSRFToken')).toBe('token-a');
    expect(second.get('X-CSRFToken')).toBe('token-b');
  });

  it('holds back every request except the login calls while the session has ended', () => {
    setSignedIn(true);
    reportUnauthorized('tab-return');

    expect(() =>
      prepareRequest('/pulp/api/v3/things/', 'GET', new Headers()),
    ).toThrow(SessionSuspendedError);
    expect(() => prepareRequest('things/', 'POST', new Headers())).toThrow(
      SessionSuspendedError,
    );
    expect(() => prepareRequest('login/', 'GET', new Headers())).not.toThrow();
    expect(() =>
      prepareRequest('/pulp/api/v3/login/', 'POST', new Headers()),
    ).not.toThrow();
  });

  it('holds back a path that only looks like a sign-in call while the session has ended', () => {
    setSignedIn(true);
    reportUnauthorized('tab-return');

    expect(() =>
      prepareRequest(
        resolveApiUrl('/pulp/api/v3/login/../users/5/'),
        'GET',
        new Headers(),
      ),
    ).toThrow(SessionSuspendedError);
  });

  it('returns one request context object per call', () => {
    const first = prepareRequest('things/', 'GET', new Headers());
    const second = prepareRequest('things/', 'GET', new Headers());

    expect(first).toBeTypeOf('object');
    expect(first).not.toBe(second);
  });
});

describe('handleFailure', () => {
  // Made at the time of the call, so it carries the epoch the test is in.
  const freshContext = () => prepareRequest('things/', 'GET', new Headers());
  const answer = (status: number) => ({ response: { status } });

  it('reports a 401 of any call except the login calls, once', async () => {
    setSignedIn(true);
    const listener = vi.fn();
    subscribe(listener);
    const sent = freshContext();

    await handleFailure(401, 'things/', answer(401), vi.fn(), sent);
    await handleFailure(401, 'login/', answer(401), vi.fn(), sent);
    await handleFailure(401, '/pulp/api/v3/login/', answer(401), vi.fn(), sent);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
  });

  it('ignores a 401 while nobody is signed in', async () => {
    await handleFailure(401, 'things/', answer(401), vi.fn(), freshContext());

    expect(getSnapshot().ended).toBe(false);
  });

  it('ignores every other status', async () => {
    setSignedIn(true);
    const check = vi.fn();

    for (const status of [400, 404, 500, 502]) {
      await handleFailure(
        status,
        'things/',
        answer(status),
        check,
        freshContext(),
      );
    }

    expect(check).not.toHaveBeenCalled();
    expect(getSnapshot().ended).toBe(false);
  });

  it('leaves a 403 a refusal when the check succeeds', async () => {
    setSignedIn(true);
    const error = answer(403);

    await handleFailure(
      403,
      'things/',
      error,
      () => Promise.resolve({ username: 'zoe' }),
      freshContext(),
    );

    expect(isMarkedSessionEnd(error)).toBe(false);
    expect(getSnapshot().ended).toBe(false);
  });

  it.each([401, 403])(
    'ends the session and marks the error when the check fails with %i',
    async (status) => {
      setSignedIn(true);
      const error = answer(403);

      await handleFailure(
        403,
        'things/',
        error,
        () => Promise.reject(answer(status)),
        freshContext(),
      );

      expect(isMarkedSessionEnd(error)).toBe(true);
      expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
    },
  );

  it.each([
    ['a server error', answer(500)],
    ['a lost connection', new TypeError('Failed to fetch')],
  ])(
    'leaves a 403 a refusal when the check fails with %s',
    async (_, failure) => {
      setSignedIn(true);
      const error = answer(403);

      await handleFailure(
        403,
        'things/',
        error,
        () => Promise.reject(failure),
        freshContext(),
      );

      expect(isMarkedSessionEnd(error)).toBe(false);
      expect(getSnapshot().ended).toBe(false);
    },
  );

  it('asks nothing for a 403 while nobody is signed in or of the login calls', async () => {
    const check = vi.fn();

    await handleFailure(403, 'things/', answer(403), check, freshContext());
    setSignedIn(true);
    await handleFailure(403, 'login/', answer(403), check, freshContext());

    expect(check).not.toHaveBeenCalled();
  });

  it.each([
    '/pulp/api/v3/roles/?fields=name%2Cpermissions&limit=1000',
    '/pulp/api/v3/roles/',
    'roles/?limit=1',
  ])(
    'asks nothing for a 403 of a read of the roles list (%s), which is the answer to what the account may read',
    async (url) => {
      setSignedIn(true);
      const check = vi.fn();
      const error = answer(403);

      await handleFailure(
        403,
        url,
        error,
        check,
        prepareRequest(url, 'GET', new Headers()),
      );

      expect(check).not.toHaveBeenCalled();
      expect(isMarkedSessionEnd(error)).toBe(false);
      expect(getSnapshot().ended).toBe(false);
    },
  );

  it.each([
    ['a read of one role', 'GET', '/pulp/api/v3/roles/0001/'],
    ['the roles of a user', 'GET', '/pulp/api/v3/users/1/roles/'],
    ['the roles of a group', 'GET', '/pulp/api/v3/groups/1/roles/'],
    ['a role being made', 'POST', '/pulp/api/v3/roles/'],
    ['a role being removed', 'DELETE', '/pulp/api/v3/roles/'],
    ['a list that only ends alike', 'GET', '/pulp/api/v3/things/roles/'],
  ])('still asks about the session for a 403 of %s', async (_, method, url) => {
    setSignedIn(true);
    const check = vi.fn(() => Promise.resolve({ username: 'zoe' }));

    await handleFailure(
      403,
      url,
      answer(403),
      check,
      prepareRequest(url, method, new Headers()),
    );

    expect(check).toHaveBeenCalledTimes(1);
  });

  it('shares one check between refusals that arrive together, whoever asks', async () => {
    setSignedIn(true);
    let finish: (value: unknown) => void = () => undefined;
    const firstCheck = vi.fn(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const secondCheck = vi.fn(() => Promise.resolve({}));

    const first = handleFailure(
      403,
      'a/',
      answer(403),
      firstCheck,
      freshContext(),
    );
    const second = handleFailure(
      403,
      'b/',
      answer(403),
      secondCheck,
      freshContext(),
    );
    finish({});
    await Promise.all([first, second]);

    expect(firstCheck).toHaveBeenCalledTimes(1);
    expect(secondCheck).not.toHaveBeenCalled();
  });

  it('asks again for a refusal that arrives after the check answered', async () => {
    setSignedIn(true);
    const check = vi.fn(() => Promise.resolve({}));

    await handleFailure(403, 'a/', answer(403), check, freshContext());
    await handleFailure(403, 'b/', answer(403), check, freshContext());

    expect(check).toHaveBeenCalledTimes(2);
  });

  describe('a refusal that belongs to an older session', () => {
    it.each([401, 403])(
      'ignores a %i of a request sent before the session was resumed',
      async (status) => {
        setSignedIn(true);
        const sentBefore = freshContext();
        resume();
        const check = vi.fn(() => Promise.reject(answer(401)));
        const error = answer(status);

        await handleFailure(status, 'things/', error, check, sentBefore);

        expect(check).not.toHaveBeenCalled();
        expect(isMarkedSessionEnd(error)).toBe(false);
        expect(getSnapshot().ended).toBe(false);
      },
    );

    it('ignores a refusal of a request sent for a user who has since signed out and in again', async () => {
      setSignedIn(true);
      const sentBefore = freshContext();
      setSignedIn(false);
      setSignedIn(true);

      await handleFailure(401, 'things/', answer(401), vi.fn(), sentBefore);

      expect(getSnapshot().ended).toBe(false);
    });

    it.each([401, 403])(
      'acts on a %i of a request sent after the session was resumed',
      async (status) => {
        setSignedIn(true);
        resume();
        const sentAfter = freshContext();

        await handleFailure(
          status,
          'things/',
          answer(status),
          () => Promise.reject(answer(401)),
          sentAfter,
        );

        expect(getSnapshot()).toEqual({ ended: true, fromRequest: true });
      },
    );

    it('ignores the outcome of a check that was answered after the session was resumed', async () => {
      setSignedIn(true);
      const sentBefore = freshContext();
      let answerCheck: (value: unknown) => void = () => undefined;
      const check = vi.fn(
        () =>
          new Promise((_, reject) => {
            answerCheck = () => reject(answer(401));
          }),
      );
      const error = answer(403);

      const pending = handleFailure(403, 'things/', error, check, sentBefore);
      resume();
      answerCheck(null);
      await pending;

      expect(check).toHaveBeenCalledTimes(1);
      expect(isMarkedSessionEnd(error)).toBe(false);
      expect(getSnapshot().ended).toBe(false);
    });

    it('still reports a refusal when the request has no context', async () => {
      setSignedIn(true);

      await handleFailure(401, 'things/', answer(401), vi.fn(), undefined);

      expect(getSnapshot().ended).toBe(true);
    });
  });
});
