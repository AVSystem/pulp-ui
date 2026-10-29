import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it } from 'vitest';
import { server } from 'src/test-utils/server';
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
});
