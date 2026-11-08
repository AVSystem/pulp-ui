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
