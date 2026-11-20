import { t } from '@lingui/core/macro';
import { type ReactNode } from 'react';
import {
  SessionSuspendedError,
  isMarkedSessionEnd,
  isSignedIn,
} from 'src/session/session-events';
import {
  errorMessage,
  forbiddenDescription,
  forbiddenTexts,
  jsxErrorMessage,
} from './fail-alerts';

// A failed request does not always carry a response: a network error, a CORS
// failure and an exception thrown before the request is sent have none. These
// helpers are the one place that reads the response of a caught error, so a
// page never fails inside its own error handler.

// The HTTP status of the failed request, or null when it never got an answer.
export function requestErrorStatus(error): number | null {
  const status = error?.response?.status;
  return typeof status === 'number' ? status : null;
}

// The reason Pulp gave in the answer's `detail` field, as plain text, or null
// when the answer has none. Only a non-empty string counts: nothing else of
// the response body is ever read.
export function requestErrorDetail(error): string | null {
  const detail = error?.response?.data?.detail;
  return typeof detail === 'string' && detail.trim() ? detail : null;
}

// The reason Pulp gave for refusing the values of a request (status 400), as
// plain text, or null when the answer has none. Pulp answers with a text, a
// list of texts, an object with a `detail` or an object of texts or lists of
// texts by field name; the first text found is the reason. Only text is ever
// read, so a body of another shape yields null.
export function requestErrorReason(error): string | null {
  if (requestErrorStatus(error) !== 400) {
    return null;
  }

  const first = (value: unknown, depth = 0): string | null => {
    if (typeof value === 'string') {
      return value.trim() ? value : null;
    }
    if (depth > 2 || typeof value !== 'object' || value === null) {
      return null;
    }
    const items = Array.isArray(value)
      ? value
      : 'detail' in value
        ? [(value as { detail: unknown }).detail]
        : Object.values(value);
    for (const item of items) {
      const found = first(item, depth + 1);
      if (found !== null) {
        return found;
      }
    }
    return null;
  };

  return first(error?.response?.data);
}

// True when the failure is the end of the session and nothing else: a 401
// answer to a user who is signed in, a request that was held back while the
// sign-in dialog is open, or a refusal that a who-is-signed-in request showed
// to be an ended session. The dialog explains it and the screen reads again
// after signing in, so the caller shows no alert and no error state of its
// own. Any other 403 or other failure is not a session end.
//
// The 401 a visitor gets is an ordinary failure: nobody was signed in, so no
// dialog opens, and treating it as a session end would leave the screen on its
// loading state with nothing to explain it. The screen shows its error state
// or alert instead.
export function isSessionEnd(error): boolean {
  return (
    error instanceof SessionSuspendedError ||
    (requestErrorStatus(error) === 401 && isSignedIn()) ||
    isMarkedSessionEnd(error)
  );
}

// Readable text for whatever was thrown. For an HTTP error it is the status
// line the pages show for a failed request; otherwise the error's own message.
// Neither the response body nor headers nor a stack are included.
export function requestErrorText(error): string {
  const status = requestErrorStatus(error);
  if (status === 403) {
    const { sentence, detail } = forbiddenTexts(error);
    return `${sentence} ${detail}`;
  }
  if (status !== null) {
    return errorMessage(status, error.response.statusText ?? '');
  }

  if (typeof error === 'string' && error) {
    return error;
  }
  if (typeof error?.message === 'string' && error.message) {
    return error.message;
  }

  return t`The request failed.`;
}

// The same text as a node for display. A refusal reads as three paragraphs.
export function requestErrorDescription(error): ReactNode {
  const status = requestErrorStatus(error);
  if (status === 403) {
    return forbiddenDescription(error);
  }
  if (status !== null) {
    return jsxErrorMessage(status, error.response.statusText ?? '');
  }

  return requestErrorText(error);
}
