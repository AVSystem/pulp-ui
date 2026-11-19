import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

// Handlers use a leading wildcard because the DOM environment resolves a
// relative request URL against its own origin, which tests must not depend on.
export const defaultHandlers = [
  http.get('*/pulp-ui-config.json', () =>
    HttpResponse.json({
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
      RESERVED_BASE_PATH_PREFIXES: [],
    }),
  ),
  // Nobody is signed in unless a test says otherwise.
  http.get('*/pulp/api/v3/login/', () =>
    HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
  ),
  // The shell asks for the tasks it shows counts and notifications for; with no
  // handler of a test, nobody has any.
  http.get('*/pulp/api/v3/tasks/', () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  // The plugins every route of the application needs.
  http.get('*/pulp/api/v3/status/', () =>
    HttpResponse.json({
      versions: [
        'core',
        'file',
        'certguard',
        'ansible',
        'container',
        'deb',
        'python',
        'rpm',
      ].map((component) => ({ component, version: '3.0.0' })),
    }),
  ),
];

export const server = setupServer(...defaultHandlers);

// Every request no handler answered, as "METHOD URL", in the order it was
// sent. Screens catch failed reads, so the rejection msw produces for an
// unmocked request never reaches the test; the setup records the request and
// fails the test that sent it, whatever the screen did with the rejection.
export const unhandledRequests: string[] = [];

// Returns the requests recorded so far and clears the record.
export function takeUnhandledRequests(): string[] {
  return unhandledRequests.splice(0, unhandledRequests.length);
}
