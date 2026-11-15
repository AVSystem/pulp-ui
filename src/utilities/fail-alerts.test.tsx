import { describe, expect, it, vi } from 'vitest';
import { SessionSuspendedError } from 'src/session/session-events';
import { handleHttpError } from './fail-alerts';

// What a failed request looks like to the caller: an error that carries the
// response.
const answered = (status: number, statusText: string) => ({
  response: { status, statusText, data: { detail: 'nope' } },
});

function run(error: unknown) {
  const alerts: { title: string; variant: string; description: unknown }[] = [];
  const callback = vi.fn();

  handleHttpError('Could not load', callback, (alert) => alerts.push(alert))(
    error,
  );

  return { alerts, callback };
}

describe('handleHttpError for the end of a session', () => {
  it('adds no alert for a 401 and still calls its callback', () => {
    const { alerts, callback } = run(answered(401, 'Unauthorized'));

    expect(alerts).toEqual([]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('adds no alert for a request that was held back and still calls its callback', () => {
    const { alerts, callback } = run(new SessionSuspendedError());

    expect(alerts).toEqual([]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('adds the alert as before for a 403', () => {
    const { alerts, callback } = run(answered(403, 'Forbidden'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      title: 'Could not load',
      variant: 'danger',
    });
    expect(String(alerts[0]?.description)).toContain('403');
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('adds the alert as before for a 500', () => {
    const { alerts } = run(answered(500, 'Internal Server Error'));

    expect(alerts).toHaveLength(1);
    expect(String(alerts[0]?.description)).toContain('500');
  });

  it('adds the alert as before for a failure without a response', () => {
    const { alerts, callback } = run(new Error('Network Error'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.description).toBe('Error: Network Error');
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
