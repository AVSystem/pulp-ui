import { act, waitFor } from '@testing-library/react';
import { expect } from 'vitest';
import { server } from './server';

// Counts the answers the mock server has given to requests whose path ends
// with the given text, from the moment of the call. A test that asserts that
// nothing happened after a request waits on this count instead of a fixed
// pause: the assertion cannot run before the request was answered, and it
// does not wait longer than that.
export function answeredRequests(pathEnd: string, method = 'GET') {
  let count = 0;
  const onAnswer = ({ request }: { request: Request }) => {
    if (
      request.method === method &&
      new URL(request.url).pathname.endsWith(pathEnd)
    ) {
      count += 1;
    }
  };
  server.events.on('response:mocked', onAnswer);

  return {
    count: () => count,
    // Resolves once at least the given number of requests were answered and
    // the screen had a turn of the event loop to react to the last answer.
    async untilAnswered(atLeast = 1) {
      await waitFor(() => expect(count).toBeGreaterThanOrEqual(atLeast));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    },
    // Removes only this counter's listener.
    stop: () => server.events.removeListener('response:mocked', onAnswer),
  };
}

// Lets the screen react to what the mock server has just answered: one turn of
// the event loop, for a test that already waited on the condition that the
// answer was given.
export const reacted = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
