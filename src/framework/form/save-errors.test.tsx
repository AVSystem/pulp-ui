import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SessionSuspendedError } from 'src/session/session-events';
import { saveFailure } from './save-errors';

const failure = (status: number, data: unknown) => ({
  response: { status, statusText: 'Status', data },
});

describe('Unit: saveFailure', { tags: ['unit'] }, () => {
  it('maps the messages of a refused value to the fields they name', () => {
    const result = saveFailure(
      failure(400, {
        description: ['Too long.'],
        retain_repo_versions: ['Too small.', 'Not a number.'],
      }),
      ['description', 'retain_repo_versions'],
    );

    expect(result).toEqual({
      fields: {
        description: 'Too long.',
        retain_repo_versions: 'Too small. Not a number.',
      },
      general: null,
    });
  });

  it('puts an error that names no field of the form in the general message, with the field it names', () => {
    const result = saveFailure(
      failure(400, {
        description: ['Too long.'],
        manifest: ['Not allowed.'],
        non_field_errors: ['Cannot combine these.'],
      }),
      ['description'],
    );

    expect(result?.fields).toEqual({ description: 'Too long.' });
    expect(result?.general).toBe(
      'manifest: Not allowed. Cannot combine these.',
    );
  });

  it('reads a detail message as a general one', () => {
    const result = saveFailure(failure(400, { detail: 'Try later.' }), [
      'description',
    ]);

    expect(result).toEqual({ fields: {}, general: 'Try later.' });
  });

  it('shows a refusal as three paragraphs: that it was refused, the reason of Pulp and whom to ask', () => {
    const result = saveFailure(failure(403, { detail: 'Not yours.' }), [
      'description',
    ]);

    expect(result?.fields).toEqual({});
    render(<>{result?.general}</>);
    expect(
      screen.getAllByText(/./).map((paragraph) => paragraph.textContent),
    ).toEqual([
      'You do not have permission to do this.',
      'Not yours.',
      'Contact your organization administrator for more information.',
    ]);
  });

  it('shows a refusal that carries no reason with a plain fallback sentence', () => {
    const result = saveFailure(failure(403, {}), []);

    render(<>{result?.general}</>);
    expect(screen.getByText('Pulp refused this request.')).toBeInTheDocument();
  });

  it('shows a failure with no readable fields as the status line', () => {
    const result = saveFailure(failure(500, null), ['description']);

    expect(result?.fields).toEqual({});
    render(<>{result?.general}</>);
    expect(screen.getByText(/500/)).toBeInTheDocument();
  });

  it('shows a failure that has no response as its own message', () => {
    const result = saveFailure(new Error('Network down'), ['description']);

    expect(result).toEqual({ fields: {}, general: 'Network down' });
  });

  it('says nothing for the end of a session, which the sign-in dialog explains', () => {
    expect(
      saveFailure(new SessionSuspendedError(), ['description']),
    ).toBeNull();
  });
});
