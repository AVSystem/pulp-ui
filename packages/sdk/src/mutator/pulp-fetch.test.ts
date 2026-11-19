import { HttpResponse, http } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { server } from '../../../../src/test-utils/server';
import { PulpRequestError, configurePulpFetch, pulpFetch } from './pulp-fetch';

describe('Integration: pulpFetch', { tags: ['integration'] }, () => {
  it('resolves with the parsed JSON body on a 2xx response', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ version: [] }),
      ),
    );

    const result = await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

    expect(result).toStrictEqual({ version: [] });
  });

  it('throws error carrying the status and parsed body on a non-2xx JSON response', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json({ detail: 'Not found.' }, { status: 404 }),
      ),
    );

    await expect(
      pulpFetch('/pulp/api/v3/status/', { method: 'GET' }),
    ).rejects.toMatchObject({
      status: 404,
      data: { detail: 'Not found.' },
    });
  });

  it('sets Content-Type: application/json when a body is present and none is set', async () => {
    let contentType: string | null = null;
    server.use(
      http.post('*/pulp/api/v3/repositories', async ({ request }) => {
        contentType = request.headers.get('content-type');
        return HttpResponse.json({});
      }),
    );

    await pulpFetch('/pulp/api/v3/repositories/', {
      method: 'POST',
      body: JSON.stringify({ name: 'test' }),
    });

    expect(contentType).toStrictEqual('application/json');
  });

  it('throws with the raw text body when a non-2xx non-JSON response', async () => {
    server.use(
      http.get(
        '*/pulp/api/v3/status',
        () =>
          new HttpResponse('<html>Internal Server Error</html>', {
            status: 500,
            headers: { 'Content-Type': 'text/html' },
          }),
      ),
    );

    await expect(
      pulpFetch('/pulp/api/v3/status/', { method: 'GET' }),
    ).rejects.toMatchObject({
      status: 500,
      data: '<html>Internal Server Error</html>',
    });
  });

  it('does not override a Content-Type header the caller has already set', async () => {
    let contentType: string | null = null;
    server.use(
      http.post('*/pulp/api/v3/repositories', async ({ request }) => {
        contentType = request.headers.get('content-type');
        return HttpResponse.json({});
      }),
    );

    await pulpFetch('/pulp/api/v3/repositories/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/merge-patch+json' },
      body: JSON.stringify({ name: 'test' }),
    });

    expect(contentType).toStrictEqual('application/merge-patch+json');
  });

  it('sends credentials: include on every request', async () => {
    let credentials: Request['credentials'] | undefined;
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        credentials = request.credentials;
        return HttpResponse.json({ version: [] });
      }),
    );

    await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

    expect(credentials).toStrictEqual('include');
  });

  it('does not set Content-Type when there is no body', async () => {
    let contentType: string | null = null;
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        contentType = request.headers.get('content-type');
        return HttpResponse.json({ version: [] });
      }),
    );

    await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

    expect(contentType).toBeNull();
  });

  it('uses application/merge-patch+json for PATCH when the caller sets no Content-Type', async () => {
    let contentType: string | null = null;
    server.use(
      http.patch(
        '*/pulp/api/v3/repositories/rpm/rpm/1234567890/',
        ({ request }) => {
          contentType = request.headers.get('content-type');
          return HttpResponse.json({});
        },
      ),
    );

    await pulpFetch('/pulp/api/v3/repositories/rpm/rpm/1234567890/', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'test' }),
    });

    expect(contentType).toStrictEqual('application/merge-patch+json');
  });

  it('resolves with undefined on a 204 No Content response', async () => {
    server.use(
      http.delete('*/pulp/api/v3/rpm/rpm/1234567890', () => {
        return new HttpResponse(undefined, { status: 204 });
      }),
    );

    const result = await pulpFetch('/pulp/api/v3/rpm/rpm/1234567890', {
      method: 'DELETE',
    });

    expect(result).toBeUndefined();
  });

  it('throws when a 2xx response is missing Content-Type', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        const res = new HttpResponse('No Headers', { status: 200 });
        res.headers.delete('content-type');
        return res;
      }),
    );

    await expect(
      pulpFetch('/pulp/api/v3/status/', { method: 'GET' }),
    ).rejects.toThrow('Response missing Content-Type header');
  });

  it('sends "X-Requested-With: XMLHttpRequest" header on every request', async () => {
    let expectedHeader: string | null = null;
    server.use(
      http.get('*/pulp/api/v3/status/', ({ request }) => {
        expectedHeader = request.headers.get('x-requested-with');
        return HttpResponse.json({ version: [] });
      }),
    );

    await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

    expect(expectedHeader).toStrictEqual('XMLHttpRequest');
  });
});

describe(
  'Integration: pulpFetch with configured hooks',
  {
    tags: ['integration'],
  },
  () => {
    afterEach(() => {
      configurePulpFetch(null);
    });

    it('requests the URL the resolver returns', async () => {
      let hit = 0;
      server.use(
        http.get('*/other/api/status/', () => {
          hit += 1;
          return HttpResponse.json({ version: [] });
        }),
      );
      configurePulpFetch({
        resolveUrl: (url) => url.replace('/pulp/api/v3/', '/other/api/'),
        beforeRequest: () => undefined,
      });

      await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

      expect(hit).toBe(1);
    });

    it('never sends a request whose URL the resolver refuses', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const beforeRequest = vi.fn();
      const onFailure = vi.fn();
      configurePulpFetch({
        resolveUrl: () => {
          throw new Error('refused');
        },
        beforeRequest,
        onFailure,
      });

      await expect(
        pulpFetch('/pulp/api/v3/status/', { method: 'GET' }),
      ).rejects.toThrow('refused');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(beforeRequest).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('hands the resolved URL, the upper-case method and the headers to beforeRequest once', async () => {
      let received: string | null = null;
      server.use(
        http.patch('*/pulp/api/v3/things/1/', ({ request }) => {
          received = request.headers.get('x-added');
          return HttpResponse.json({});
        }),
      );
      const beforeRequest = vi.fn(
        (_url: string, _method: string, headers: Headers) => {
          headers.set('X-Added', 'yes');
        },
      );
      configurePulpFetch({ resolveUrl: (url) => url, beforeRequest });

      await pulpFetch('/pulp/api/v3/things/1/', {
        method: 'patch',
        body: '{}',
      });

      expect(beforeRequest).toHaveBeenCalledTimes(1);
      expect(beforeRequest.mock.calls[0]?.[0]).toBe('/pulp/api/v3/things/1/');
      expect(beforeRequest.mock.calls[0]?.[1]).toBe('PATCH');
      expect(received).toBe('yes');
    });

    it('treats a request without a method as a GET', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', () => HttpResponse.json({})),
      );
      const beforeRequest = vi.fn();
      configurePulpFetch({ resolveUrl: (url) => url, beforeRequest });

      await pulpFetch('/pulp/api/v3/status/', {});

      expect(beforeRequest.mock.calls[0]?.[1]).toBe('GET');
    });

    it('does not send the request when beforeRequest rejects and reports no failure', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const onFailure = vi.fn();
      configurePulpFetch({
        resolveUrl: (url) => url,
        beforeRequest: () => Promise.reject(new Error('held')),
        onFailure,
      });

      await expect(
        pulpFetch('/pulp/api/v3/status/', { method: 'GET' }),
      ).rejects.toThrow('held');

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(onFailure).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('gives onFailure the error and the value beforeRequest resolved to, once', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', () =>
          HttpResponse.json(
            { detail: 'No.' },
            { status: 403, statusText: 'Forbidden' },
          ),
        ),
      );
      const context = { sentAt: 1 };
      const onFailure = vi.fn();
      configurePulpFetch({
        resolveUrl: (url) => url,
        beforeRequest: () => Promise.resolve(context),
        onFailure,
      });

      const error = await pulpFetch('/pulp/api/v3/status/', {
        method: 'GET',
      }).catch((e) => e);

      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure.mock.calls[0]?.[0]).toBe(error);
      expect(onFailure.mock.calls[0]?.[1]).toBe(context);
    });

    it('waits for onFailure before the error reaches the caller', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', () =>
          HttpResponse.json({ detail: 'No.' }, { status: 401 }),
        ),
      );
      let finished = false;
      configurePulpFetch({
        resolveUrl: (url) => url,
        beforeRequest: () => undefined,
        onFailure: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          finished = true;
        },
      });

      await pulpFetch('/pulp/api/v3/status/', { method: 'GET' }).catch(
        () => undefined,
      );

      expect(finished).toBe(true);
    });

    it('reports no failure for a successful answer', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', () => HttpResponse.json({})),
      );
      const onFailure = vi.fn();
      configurePulpFetch({
        resolveUrl: (url) => url,
        beforeRequest: () => undefined,
        onFailure,
      });

      await pulpFetch('/pulp/api/v3/status/', { method: 'GET' });

      expect(onFailure).not.toHaveBeenCalled();
    });

    it('passes the caller signal on so a cancelled request is cancelled', async () => {
      server.use(
        http.get('*/pulp/api/v3/status/', async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return HttpResponse.json({});
        }),
      );
      configurePulpFetch({
        resolveUrl: (url) => url,
        beforeRequest: () => undefined,
      });
      const controller = new AbortController();

      const pending = pulpFetch('/pulp/api/v3/status/', {
        method: 'GET',
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    });
  },
);

describe('Unit: PulpRequestError', { tags: ['unit'] }, () => {
  it('carries the status, the body and the response the app helpers read', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () =>
        HttpResponse.json(
          { detail: 'Not found.' },
          { status: 404, statusText: 'Not Found' },
        ),
      ),
    );

    const error = await pulpFetch<never>('/pulp/api/v3/status/', {
      method: 'GET',
    }).catch((e: PulpRequestError) => e);

    expect(error).toBeInstanceOf(PulpRequestError);
    expect(error).toBeInstanceOf(Error);
    expect(error.status).toBe(404);
    expect(error.data).toEqual({ detail: 'Not found.' });
    expect(error.response).toEqual({
      status: 404,
      statusText: 'Not Found',
      data: { detail: 'Not found.' },
    });
  });

  it('is still built for a failed answer that has no Content-Type', async () => {
    server.use(
      http.get('*/pulp/api/v3/status/', () => {
        const res = new HttpResponse(null, { status: 401 });
        res.headers.delete('content-type');
        return res;
      }),
    );

    const error = await pulpFetch<never>('/pulp/api/v3/status/', {
      method: 'GET',
    }).catch((e: PulpRequestError) => e);

    expect(error).toBeInstanceOf(PulpRequestError);
    expect(error.response.status).toBe(401);
    expect(error.response.data).toBeUndefined();
  });
});
