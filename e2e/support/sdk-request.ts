import type { APIRequestContext, APIResponse } from '@playwright/test';

// Typed requests for the e2e support code. The address of a call comes from a
// URL builder of the generated client (or from a href the server returned) and
// the shapes of the answers from the generated types; the transport is
// Playwright's request context. The browser mutator of the client is never
// used: it belongs to the page, and a test must not depend on the code it is
// checking.
//
// A builder returns "/<href>" and every href starts with "/", so a builder
// given an href yields an address that starts with two slashes. Left alone,
// that reads as a protocol-relative address and the request goes to a host
// named after the first path segment; resolveApiUrl collapses the run of
// slashes the same way the application does before it sends a request.

// One request and its answer: the status and the body parsed as JSON (or
// undefined when the answer has no body).
export interface ApiAnswer<T> {
  status: number;
  body: T;
}

type Params = Record<string, string>;

// The address a request goes to: a single leading slash, and the query
// parameters appended to whatever query the address already carries.
export function resolveApiUrl(url: string, params: Params = {}): string {
  const path = url.replace(/^\/+/, '/');
  const query = new URLSearchParams(params).toString();
  if (!query) {
    return path;
  }
  return `${path}${path.includes('?') ? '&' : '?'}${query}`;
}

async function parse<T>(response: APIResponse): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// The error of a request the server refused, with the start of its answer.
export async function requestFailure(
  method: string,
  url: string,
  response: APIResponse,
): Promise<Error> {
  const body = (await response.text()).slice(0, 300);
  return new Error(`${method} ${url}: ${response.status()} ${body}`);
}

interface CallOptions {
  params?: Params;
  data?: unknown;
  // a multipart body, for the endpoints that take a file
  multipart?: Record<
    string,
    string | { name: string; mimeType: string; buffer: Buffer }
  >;
  // statuses that are not failures besides the 2xx ones, for example 404 for a
  // read of an object that may already be gone
  accept?: number[];
}

// The one place a request is sent. A status outside 2xx and `accept` throws.
export async function apiCall<T>(
  api: APIRequestContext,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  { params, data, multipart, accept = [] }: CallOptions = {},
): Promise<ApiAnswer<T>> {
  const target = resolveApiUrl(url, params);
  const response = await api.fetch(target, {
    method,
    ...(data === undefined ? {} : { data }),
    ...(multipart === undefined ? {} : { multipart }),
  });
  if (!response.ok() && !accept.includes(response.status())) {
    throw await requestFailure(method, target, response);
  }
  return {
    status: response.status(),
    body: response.ok() ? await parse<T>(response) : (undefined as T),
  };
}

export async function apiGet<T>(
  api: APIRequestContext,
  url: string,
  params?: Params,
): Promise<T> {
  return (await apiCall<T>(api, 'GET', url, params ? { params } : {})).body;
}

export async function apiPost<T>(
  api: APIRequestContext,
  url: string,
  data?: unknown,
): Promise<T> {
  return (await apiCall<T>(api, 'POST', url, { data })).body;
}

// A multipart POST: text fields and file parts.
export async function apiPostForm<T>(
  api: APIRequestContext,
  url: string,
  multipart: NonNullable<CallOptions['multipart']>,
): Promise<T> {
  return (await apiCall<T>(api, 'POST', url, { multipart })).body;
}

export async function apiPatch<T>(
  api: APIRequestContext,
  url: string,
  data?: unknown,
): Promise<T> {
  return (await apiCall<T>(api, 'PATCH', url, { data })).body;
}

// Returns the status, so a caller can tell a deletion the server finished
// (204) from one it started as a task (202), or one that found nothing (404,
// when accepted).
export async function apiDelete(
  api: APIRequestContext,
  url: string,
  accept: number[] = [],
): Promise<ApiAnswer<{ task?: string } | undefined>> {
  return apiCall<{ task?: string } | undefined>(api, 'DELETE', url, {
    accept,
  });
}
