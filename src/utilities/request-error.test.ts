import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { PulpAPI } from '../api/pulp';
import { server } from '../test-utils/server';
import { requestErrorStatus, requestErrorText } from './request-error';

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
