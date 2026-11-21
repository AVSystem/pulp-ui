import { HttpResponse, http } from 'msw';
import { server } from './server';

export interface SentRequest {
  method: string;
  path: string;
  search: string;
  body: unknown;
}

// Answers every request below the API base with an empty object and records
// what was sent, so a test can compare the path a member requested with the
// path it is meant to request.
export function recordApiRequests(): SentRequest[] {
  const sent: SentRequest[] = [];
  const record = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = await request.text();
    sent.push({
      method: request.method,
      path: url.pathname,
      search: url.search,
      body: text ? JSON.parse(text) : undefined,
    });
    return HttpResponse.json({});
  };
  server.use(http.all('*/pulp/api/v3/*', record));
  return sent;
}

// Addresses a member of the legacy request layer must never act on: they leave
// the API base, name another collection, or hide a dot segment in an escape.
export function hrefsOutsideCollection(collection: string): string[] {
  const id = '00000000-0000-4000-8000-0000000000aa';

  return [
    `/other/api/v3/${collection}${id}/`,
    `https://evil.example/pulp/api/v3/${collection}${id}/`,
    `//evil.example/pulp/api/v3/${collection}${id}/`,
    `/pulp/api/v3/${collection}%2e%2e/%2e%2e/users/${id}/`,
    `/pulp/api/v3/${collection}${id}/?next=1`,
    `/pulp/api/v3/${collection}${id}/versions/1/`,
    `/pulp/api/v3/users/${id}/`,
    '/pulp/api/v3/',
    '',
  ];
}
