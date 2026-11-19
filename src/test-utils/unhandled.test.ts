import { describe, expect, it } from 'vitest';
import { server, takeUnhandledRequests } from './server';

// The setup fails any test that sent a request without a handler. This test
// checks the record directly and drains it, so it does not fail its own check.
describe('unhandled request record', () => {
  it('records a request after the listeners of the server were removed', async () => {
    server.events.removeAllListeners();
    await fetch('/another/unmocked/path').catch(() => undefined);

    expect(takeUnhandledRequests()).toHaveLength(1);
  });

  it('records a request no handler answers, even when the caller swallows the rejection', async () => {
    await fetch('/some/unmocked/path', { method: 'POST' }).catch(
      () => undefined,
    );

    expect(takeUnhandledRequests()).toEqual([
      expect.stringMatching(/^POST http:\/\/[^/]+\/some\/unmocked\/path$/),
    ]);
  });

  it('records nothing for a request a handler answers', async () => {
    await fetch('/pulp-ui-config.json');

    expect(takeUnhandledRequests()).toEqual([]);
  });

  it('starts every test with an empty record', () => {
    expect(takeUnhandledRequests()).toEqual([]);
  });
});
