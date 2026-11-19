import { afterEach, describe, expect, it } from 'vitest';
import { ResponseShapeError } from 'src/entities/response-shape';
import {
  SessionSuspendedError,
  resetSessionEvents,
  setSignedIn,
} from 'src/session/session-events';
import { createQueryClient, retryPolicy } from './client';

const httpError = (status: number) => ({
  response: { status, statusText: '', data: {} },
});

describe('Unit: createQueryClient', { tags: ['unit'] }, () => {
  afterEach(() => resetSessionEvents());

  it('keeps an answer fresh for 30 seconds and ignores focus changes', () => {
    const options = createQueryClient().getDefaultOptions().queries;

    expect(options?.staleTime).toBe(30_000);
    expect(options?.refetchOnWindowFocus).toBe(false);
    expect(options?.throwOnError).toBe(false);
  });

  it('retries a network failure twice and then gives up', () => {
    const network = new Error('Network Error');

    expect(retryPolicy(0, network)).toBe(true);
    expect(retryPolicy(1, network)).toBe(true);
    expect(retryPolicy(2, network)).toBe(false);
  });

  it('retries a server failure but not a client failure', () => {
    expect(retryPolicy(0, httpError(500))).toBe(true);
    expect(retryPolicy(0, httpError(503))).toBe(true);
    expect(retryPolicy(0, httpError(400))).toBe(false);
    expect(retryPolicy(0, httpError(403))).toBe(false);
    expect(retryPolicy(0, httpError(404))).toBe(false);
    expect(retryPolicy(0, httpError(499))).toBe(false);
  });

  it('does not retry a request held back while the session has ended', () => {
    expect(retryPolicy(0, new SessionSuspendedError())).toBe(false);
  });

  it('does not retry the 401 that ends a signed-in session', () => {
    setSignedIn(true);

    expect(retryPolicy(0, httpError(401))).toBe(false);
  });

  it('does not retry the 401 a visitor gets', () => {
    expect(retryPolicy(0, httpError(401))).toBe(false);
  });

  it('does not retry an answer of the wrong shape', () => {
    expect(retryPolicy(0, new ResponseShapeError('versions.0.component'))).toBe(
      false,
    );
  });

  it('uses the policy for every query', () => {
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(
      retryPolicy,
    );
  });
});
