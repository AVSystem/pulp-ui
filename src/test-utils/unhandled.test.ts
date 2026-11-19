import { describe, expect, it } from 'vitest';
import { takeUnhandledRequests } from './server';

// The setup fails any test that sent a request without a handler. This test
// checks the record directly and drains it, so it does not fail its own check.
describe('unhandled request record', () => {
  it('records a request no handler answers, even when the caller swallows the rejection', async () => {
    await fetch('http://unmocked.invalid/some/path', { method: 'POST' }).catch(
      () => undefined,
    );

    expect(takeUnhandledRequests()).toEqual([
      'POST http://unmocked.invalid/some/path',
    ]);
  });

  it('records nothing for a request a handler answers', async () => {
    await fetch('http://localhost/pulp-ui-config.json');

    expect(takeUnhandledRequests()).toEqual([]);
  });

  it('starts every test with an empty record', () => {
    expect(takeUnhandledRequests()).toEqual([]);
  });
});
