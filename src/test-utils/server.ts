import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';

// Handlers use a leading wildcard because the DOM environment resolves a
// relative request URL against its own origin, which tests must not depend on.
export const defaultHandlers = [
  http.get('*/pulp-ui-config.json', () =>
    HttpResponse.json({
      API_BASE_PATH: '/pulp/api/v3/',
      UI_BASE_PATH: '/ui/',
    }),
  ),
  // Nobody is signed in unless a test says otherwise.
  http.get('*/pulp/api/v3/login/', () =>
    HttpResponse.json({ detail: 'Not authenticated.' }, { status: 401 }),
  ),
];

export const server = setupServer(...defaultHandlers);
