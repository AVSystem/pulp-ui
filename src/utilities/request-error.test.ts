import { HttpResponse, http } from 'msw';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SessionSuspendedError,
  getSnapshot,
  resetSessionEvents,
  setSignedIn,
  subscribe,
} from 'src/session/session-events';
import { PulpAPI } from '../api/pulp';
import { server } from '../test-utils/server';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
  requestErrorText,
} from './request-error';

// What a failed request looks like to the caller, as axios produces it.
async function failure(handler: Parameters<typeof http.get>[1]) {
  server.use(http.get('*/pulp/api/v3/things/', handler));
  try {
    await new PulpAPI().http.get('things/');
  } catch (e) {
    return e;
  }
  throw new Error('the request was expected to fail');
}

describe('requestErrorStatus', () => {
  it('is the status of the response', async () => {
    const error = await failure(() =>
      HttpResponse.json({}, { status: 503, statusText: 'Service Unavailable' }),
    );
    expect(requestErrorStatus(error)).toBe(503);
  });

  it('is the status of a rejection that only carries a response', () => {
    expect(requestErrorStatus({ response: { status: 404 } })).toBe(404);
  });

  it('is null for a network error, which has no response', async () => {
    const error = await failure(() => HttpResponse.error());
    expect(requestErrorStatus(error)).toBeNull();
  });

  it.each([
    ['an Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('is null for %s', (_name, value) => {
    expect(requestErrorStatus(value)).toBeNull();
  });
});

describe('requestErrorText', () => {
  it('shows the status code and status text of an HTTP error unchanged', async () => {
    const error = await failure(() =>
      HttpResponse.json({}, { status: 503, statusText: 'Service Unavailable' }),
    );
    expect(requestErrorText(error)).toBe('Error 503 - Service Unavailable');
  });

  it('adds the explanation the page shows for a server error', async () => {
    const error = await failure(() =>
      HttpResponse.json(
        {},
        { status: 500, statusText: 'Internal Server Error' },
      ),
    );
    expect(requestErrorText(error)).toMatch(
      /^Error 500 - Internal Server Error: .*server encountered an error/,
    );
  });

  it('shows the message of a network error, which has no response', async () => {
    const error = await failure(() => HttpResponse.error());
    expect(requestErrorText(error)).toBe((error as Error).message);
    expect(requestErrorText(error)).not.toBe('');
  });

  it('shows the message of an Error', () => {
    expect(requestErrorText(new Error('x'))).toBe('x');
  });

  it('shows a string as it is', () => {
    expect(requestErrorText('could not connect')).toBe('could not connect');
  });

  it('treats an HTTP error whose status text is missing as a status line without text', () => {
    expect(requestErrorText({ response: { status: 502 } })).toMatch(
      /^Error 502 - /,
    );
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an Error without a message', new Error('')],
    ['an empty string', ''],
    ['an object with no message', {}],
  ])('gives readable text for %s', (_name, value) => {
    const text = requestErrorText(value);
    expect(text).toMatch(/\w/);
    expect(text).not.toMatch(/undefined|null|\[object/);
  });

  it('never includes the response body, headers or a stack', async () => {
    const error = await failure(() =>
      HttpResponse.json(
        { detail: 'secret-body-text' },
        {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'X-Secret-Header': 'secret-header-text' },
        },
      ),
    );
    const text = requestErrorText(error);
    expect(text).not.toContain('secret-body-text');
    expect(text).not.toContain('secret-header-text');
    expect(text).not.toMatch(/\n\s+at /);
  });
});

describe('isSessionEnd', () => {
  afterEach(() => {
    resetSessionEvents();
  });

  it('is true for a 401 answer while a user is signed in', async () => {
    setSignedIn(true);
    const error = await failure(() =>
      HttpResponse.json({}, { status: 401, statusText: 'Unauthorized' }),
    );
    expect(isSessionEnd(error)).toBe(true);
    expect(getSnapshot().ended).toBe(true);
  });

  it('is false for the 401 answer a visitor gets, which reports no ended session', async () => {
    const listener = vi.fn();
    subscribe(listener);

    const error = await failure(() =>
      HttpResponse.json({}, { status: 401, statusText: 'Unauthorized' }),
    );

    expect(isSessionEnd(error)).toBe(false);
    expect(requestErrorStatus(error)).toBe(401);
    expect(listener).not.toHaveBeenCalled();
    expect(getSnapshot().ended).toBe(false);
  });

  it('is false for a 401 answer once the user has signed out', async () => {
    setSignedIn(true);
    setSignedIn(false);

    const error = await failure(() => HttpResponse.json({}, { status: 401 }));

    expect(isSessionEnd(error)).toBe(false);
  });

  it('is true for a request that was held back while the session is renewed', () => {
    expect(isSessionEnd(new SessionSuspendedError())).toBe(true);
  });

  it.each([403, 404, 500, 503])('is false for a %i answer', async (status) => {
    const error = await failure(() => HttpResponse.json({}, { status }));
    expect(isSessionEnd(error)).toBe(false);
  });

  it('is false for a network error', async () => {
    const error = await failure(() => HttpResponse.error());
    expect(isSessionEnd(error)).toBe(false);
  });

  it.each([
    ['an Error', new Error('boom')],
    ['a string', 'boom'],
    ['null', null],
    ['undefined', undefined],
  ])('is false for %s', (_name, value) => {
    expect(isSessionEnd(value)).toBe(false);
  });
});

const refused = (data?: unknown) => ({
  response: { status: 403, statusText: 'Forbidden', data },
});

describe('requestErrorDetail', () => {
  it('is the detail of the answer', () => {
    expect(requestErrorDetail(refused({ detail: 'Not for you.' }))).toBe(
      'Not for you.',
    );
  });

  it.each([
    ['no body', undefined],
    ['an empty body', {}],
    ['a blank detail', { detail: '   ' }],
    ['a detail that is not text', { detail: { reason: 'x' } }],
    ['a string body', 'Forbidden'],
  ])('is null for %s', (_name, data) => {
    expect(requestErrorDetail(refused(data))).toBeNull();
  });

  it('is null for a failure without a response', () => {
    expect(requestErrorDetail(new Error('boom'))).toBeNull();
    expect(requestErrorDetail(null)).toBeNull();
  });
});

describe('a refused request (403)', () => {
  it('has the sentence and the detail as text, with no client-written status sentence', () => {
    expect(requestErrorText(refused({ detail: 'Not for you.' }))).toBe(
      'You do not have permission to do this. Not for you.',
    );
  });

  it('falls back to Pulp refused this request when there is no detail', () => {
    expect(requestErrorText(refused({}))).toBe(
      'You do not have permission to do this. Pulp refused this request.',
    );
  });

  it('describes the refusal in three paragraphs', () => {
    const html = renderToStaticMarkup(
      requestErrorDescription(refused({ detail: 'Not for you.' })) as never,
    );

    expect(html.match(/<p[ >]/g)).toHaveLength(3);
    expect(html).toContain('You do not have permission to do this.');
    expect(html).toContain('Not for you.');
    expect(html).toContain(
      'Contact your organization administrator for more information.',
    );
    expect(html).not.toContain('Error 403');
  });

  it('escapes markup in the detail', () => {
    const html = renderToStaticMarkup(
      requestErrorDescription(refused({ detail: '<b>x</b>' })) as never,
    );

    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).not.toContain('<b>');
  });

  it('never includes another field of the body', () => {
    const text = requestErrorText(
      refused({ detail: 'Not for you.', secret: 'secret-body-text' }),
    );

    expect(text).not.toContain('secret-body-text');
  });
});
