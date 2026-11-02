import { describe, expect, it } from 'vitest';
import { handleHttpError } from './fail-alerts';
import { mapErrorMessages } from './map-error-messages';

describe('mapErrorMessages', () => {
  it('returns no messages for an error that has no response', () => {
    expect(mapErrorMessages(new Error('Network Error'))).toEqual({});
  });

  it('returns no messages for a response without a body', () => {
    expect(mapErrorMessages({ response: { status: 502 } })).toEqual({});
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
