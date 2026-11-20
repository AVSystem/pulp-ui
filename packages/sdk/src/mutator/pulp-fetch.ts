enum ALLOWED_CONTENT_TYPES {
  JSON = 'application/json',
  MERGE_PATCH = 'application/merge-patch+json',
}

/**
 * Sets Content-Type header to selected allowed value.
 * @param {Headers} headers Request headers.
 * @param {ALLOWED_CONTENT_TYPES} type Allowed content types.
 * @returns {void} Sets Content-Type header to selected allowed value.
 */
const setContentType = (headers: Headers, type: ALLOWED_CONTENT_TYPES): void =>
  headers.set('Content-Type', type);

/**
 * Builds headers for a request, deferring to any the caller has already set.
 * @param {RequestInit} options Initial Request options.
 * @returns {Headers} Returns request headers.
 */
function defineHeaders(options: RequestInit): Headers {
  const headers = new Headers(options.headers);

  // A multipart body carries its boundary in the Content-Type that fetch adds
  // itself; any label set here would make the body unparsable.
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    if (options.method === 'PATCH') {
      setContentType(headers, ALLOWED_CONTENT_TYPES.MERGE_PATCH);
    } else if (options.body !== undefined) {
      setContentType(headers, ALLOWED_CONTENT_TYPES.JSON);
    }
  }

  // NOTE: pulpcore checks for this header on every request and suppresses the native Basic-auth popup on a 401.
  // REF: https://github.com/pulp/pulpcore/blob/f647966fecd0cce43d08ce907ea079d309ca8f0a/pulpcore/app/authentication.py#L23-L29
  headers.set('X-Requested-With', 'XMLHttpRequest');

  return headers;
}

/**
 * Reads and parses a response body based on its Content-Type or Status Code.
 * A failed answer without a Content-Type has no body to read: it must still
 * become a request error, or a bare 401 or 403 would never reach the failure
 * hook and the end of a session would go unnoticed.
 * @param {Response} res Response to read.
 * @returns {unknown} The parsed JSON body, raw test for non-JSON or undefined.
 */
function getBody(res: Response): unknown {
  if (res.status === 204) {
    return undefined;
  }

  const contentType = res.headers.get('content-type');

  if (!contentType) {
    if (!res.ok) {
      return undefined;
    }
    throw new Error('Response missing Content-Type header');
  }

  if (contentType.includes(ALLOWED_CONTENT_TYPES.JSON)) {
    return res.json();
  }
  return res.text();
}

/**
 * The error of a request the server answered with a failure status. It carries
 * the status and body directly and as a `response` object, the shape the
 * application's error helpers read.
 */
class PulpRequestError extends Error {
  readonly status: number;
  readonly data: unknown;
  readonly response: { status: number; statusText: string; data: unknown };

  constructor(status: number, statusText: string, data: unknown) {
    super(`Request failed with status ${status}`);
    this.name = 'PulpRequestError';
    this.status = status;
    this.data = data;
    this.response = { status, statusText, data };
  }
}

/**
 * The application's rules for every request, registered once at startup. The
 * sdk cannot import application code, so the application hands them in.
 */
interface PulpFetchHooks<TContext = unknown> {
  /**
   * Turns a generated or server-issued path into the URL to request, or throws
   * to refuse the request. Runs before anything else, so a refused request
   * never reaches the network.
   */
  resolveUrl(url: string): string;
  /**
   * Runs once the URL is resolved and may add headers or throw to hold the
   * request back. The value it returns is the request context, handed to
   * onFailure unchanged if the request fails.
   */
  beforeRequest(
    url: string,
    method: string,
    headers: Headers,
  ): Promise<TContext> | TContext;
  /**
   * Sees every answer with a failure status once, before the error reaches the
   * caller. The error is thrown afterwards whatever this does.
   */
  onFailure?(error: PulpRequestError, context: TContext): Promise<void> | void;
}

let hooks: PulpFetchHooks | null = null;

/**
 * Registers the application's request rules, or removes them with null.
 * Without rules a request goes out as given.
 * @param {PulpFetchHooks | null} next The rules to apply to every request.
 * @returns {void}
 */
function configurePulpFetch<TContext>(
  next: PulpFetchHooks<TContext> | null,
): void {
  hooks = next as PulpFetchHooks | null;
}

/**
 * Custom Pulp Orval mutator. Sends all API Requests with the expected request options and returns the parsed response.
 * @param {string} url Request URL.
 * @param {RequestInit} options Request Fetch Options.
 * @returns {Promise<T>} Parsed response body on success.
 */
async function pulpFetch<T>(url: string, options: RequestInit): Promise<T> {
  const rules = hooks;
  const target = rules ? rules.resolveUrl(url) : url;
  const headers = defineHeaders(options);
  const context = rules
    ? await rules.beforeRequest(
        target,
        (options.method ?? 'GET').toUpperCase(),
        headers,
      )
    : undefined;

  const response = await fetch(target, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await getBody(response);

  if (!response.ok) {
    const error = new PulpRequestError(
      response.status,
      response.statusText,
      data,
    );
    await rules?.onFailure?.(error, context);
    throw error;
  }

  return data as Promise<T>;
}

export { PulpRequestError, configurePulpFetch, pulpFetch };
export type { PulpFetchHooks };
