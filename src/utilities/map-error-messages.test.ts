import { describe, expect, it } from 'vitest';
import { SessionSuspendedError } from 'src/session/session-events';
import { handleHttpError } from './fail-alerts';
import {
  alertErrorsWithoutFields,
  mapErrorMessages,
} from './map-error-messages';

describe('mapErrorMessages', () => {
  it('returns no messages for an error that has no response', () => {
    expect(mapErrorMessages(new Error('Network Error'))).toEqual({});
  });

  it('returns no messages for a response without a body', () => {
    expect(mapErrorMessages({ response: { status: 502 } })).toEqual({});
  });

  it.each([
    ['a number', 5],
    ['a boolean', true],
  ])('returns no messages for a response body that is %s', (_name, data) => {
    expect(mapErrorMessages({ response: { status: 500, data } })).toEqual({});
  });

  it('maps a plain text body onto the field-less key', () => {
    expect(
      mapErrorMessages({ response: { status: 500, data: 'boom' } }),
    ).toEqual({ __nofield: 'boom' });
  });

  it('keeps the field messages of a Pulp error body', () => {
    expect(
      mapErrorMessages({
        response: { status: 400, data: { name: ['taken'] } },
      }),
    ).toEqual({ name: ['taken'] });
  });
});

describe('mapErrorMessages and a session end', () => {
  const unauthorized = {
    response: {
      status: 401,
      statusText: 'Unauthorized',
      data: { detail: 'Authentication credentials were not provided.' },
    },
  };

  it('returns no messages for a 401, so no form shows the old sentence', () => {
    expect(mapErrorMessages(unauthorized)).toEqual({});
  });

  it('returns no messages for a request that was held back', () => {
    expect(mapErrorMessages(new SessionSuspendedError())).toEqual({});
  });

  it('still maps a 403 body', () => {
    expect(
      mapErrorMessages({
        response: { status: 403, data: { detail: 'Forbidden.' } },
      }),
    ).toEqual({ detail: 'Forbidden.' });
  });

  it('adds no danger alert for a session end and still adds one for another failure', () => {
    const alerts = [];
    const add = (alert) => alerts.push(alert);

    alertErrorsWithoutFields(
      mapErrorMessages(unauthorized),
      ['name'],
      add,
      'Could not save',
      () => undefined,
    );
    expect(alerts).toEqual([]);

    alertErrorsWithoutFields(
      mapErrorMessages({ response: { status: 500, data: 'boom' } }),
      ['name'],
      add,
      'Could not save',
      () => undefined,
    );
    expect(alerts).toEqual([
      { variant: 'danger', title: 'Could not save', description: 'boom' },
    ]);
  });
});

describe('handleHttpError', () => {
  it('alerts with the error text when the failure has no response', () => {
    const alerts = [];
    let called = false;

    handleHttpError(
      'Could not load',
      () => (called = true),
      (alert) => alerts.push(alert),
    )(new Error('Network Error'));

    expect(called).toBe(true);
    expect(alerts).toEqual([
      {
        title: 'Could not load',
        variant: 'danger',
        description: 'Error: Network Error',
      },
    ]);
  });

  it('alerts with the status line and the server message when there is a response', () => {
    const alerts = [];

    handleHttpError(
      'Could not load',
      () => undefined,
      (alert) => alerts.push(alert),
    )({
      response: {
        status: 400,
        statusText: 'Bad Request',
        data: { detail: 'nope' },
      },
    });

    expect(alerts[0].description).toContain('400');
    expect(alerts[0].description).toContain('nope');
  });
});
