import { t } from '@lingui/core/macro';
import { type ReactNode } from 'react';
import {
  SessionSuspendedError,
  isMarkedSessionEnd,
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

// True when the failure is the end of the session and nothing else: a 401
// answer, a request that was held back while the sign-in dialog is open, or a
// refusal that a who-is-signed-in request showed to be an ended session. The
// dialog explains it and the screen reads again after signing in, so the
// caller shows no alert and no error state of its own. Any other 403 or other
// failure is not a session end.
export function isSessionEnd(error): boolean {
  return (
    error instanceof SessionSuspendedError ||
    requestErrorStatus(error) === 401 ||
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
