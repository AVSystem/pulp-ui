import { screen } from '@testing-library/react';
import { type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SessionSuspendedError } from 'src/session/session-events';
import { renderWithProviders } from '../test-utils/render';
import { errorMessage, handleHttpError, jsxErrorMessage } from './fail-alerts';

// What a failed request looks like to the caller: an error that carries the
// response.
const answered = (
  status: number,
  statusText: string,
  detail: string | null = 'nope',
) => ({
  response: {
    status,
    statusText,
    data: detail === null ? {} : { detail },
  },
});

function run(error: unknown, title = 'Could not load') {
  const alerts: {
    id?: string;
    title: string;
    variant: string;
    description: ReactNode;
  }[] = [];
  const callback = vi.fn();

  handleHttpError(title, callback, (alert) => alerts.push(alert))(error);

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

const paragraphs = () =>
  Array.from(document.querySelectorAll('p')).map((p) => p.textContent);

describe('handleHttpError for a refused action', () => {
  it('titles the alert with the action and describes the refusal in three paragraphs', () => {
    const { alerts, callback } = run(answered(403, 'Forbidden', 'no'));

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      title: 'Could not load',
      variant: 'danger',
    });
    expect(callback).toHaveBeenCalledTimes(1);

    renderWithProviders(<>{alerts[0].description}</>);
    expect(paragraphs()).toEqual([
      'You do not have permission to do this.',
      'no',
      'Contact your organization administrator for more information.',
    ]);
  });

  it('says Pulp refused the request when the answer has no detail', () => {
    const { alerts } = run(answered(403, 'Forbidden', null));

    renderWithProviders(<>{alerts[0].description}</>);
    expect(paragraphs()).toEqual([
      'You do not have permission to do this.',
      'Pulp refused this request.',
      'Contact your organization administrator for more information.',
    ]);
  });

  it('shows markup in the detail as text and writes no 403 sentence of its own', () => {
    const { alerts } = run(
      answered(403, 'Forbidden', '<img src=x onerror=alert(1)>'),
    );

    const { container } = renderWithProviders(<>{alerts[0].description}</>);
    expect(
      screen.getByText('<img src=x onerror=alert(1)>'),
    ).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toMatch(/Error 403|Forbidden:/);
  });

  it('wraps a long unbroken detail inside the alert', () => {
    const { alerts } = run(answered(403, 'Forbidden', 'x'.repeat(300)));

    renderWithProviders(<>{alerts[0].description}</>);
    expect(screen.getByText('x'.repeat(300))).toHaveClass(
      'pulp-break-anywhere',
    );
  });

  it('gives the same refusal of the same action the same alert id, and another action another', () => {
    const first = run(answered(403, 'Forbidden', 'a'), 'Could not save').alerts;
    const again = run(answered(403, 'Forbidden', 'a'), 'Could not save').alerts;
    const other = run(
      answered(403, 'Forbidden', 'a'),
      'Could not delete',
    ).alerts;

    expect(first[0].id).toBeTruthy();
    expect(first[0].id).toBe(again[0].id);
    expect(other[0].id).not.toBe(first[0].id);
  });

  it('gives no alert id to any other failure', () => {
    expect(run(answered(500, 'Internal Server Error')).alerts[0].id).toBe(
      undefined,
    );
  });
});

describe('the status line of a failed request', () => {
  it('has no client-written sentence for a 401 or a 403', () => {
    expect(errorMessage(401, 'Unauthorized')).toBe('Error 401 - Unauthorized');
    expect(errorMessage(403, 'Forbidden')).toBe('Error 403 - Forbidden');
  });

  it('puts no sign-in link in the description of a 401', () => {
    const { container } = renderWithProviders(
      <>{jsxErrorMessage(401, 'Unauthorized')}</>,
    );

    expect(container.querySelector('a')).toBeNull();
  });
});
