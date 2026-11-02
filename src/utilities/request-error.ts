import { t } from '@lingui/core/macro';
import { type ReactNode } from 'react';
import { errorMessage, jsxErrorMessage } from './fail-alerts';

// A failed request does not always carry a response: a network error, a CORS
// failure and an exception thrown before the request is sent have none. These
// helpers are the one place that reads the response of a caught error, so a
// page never fails inside its own error handler.

// The HTTP status of the failed request, or null when it never got an answer.
export function requestErrorStatus(error): number | null {
  const status = error?.response?.status;
  return typeof status === 'number' ? status : null;
}

// Readable text for whatever was thrown. For an HTTP error it is the status
// line the pages show for a failed request; otherwise the error's own message.
// Neither the response body nor headers nor a stack are included.
export function requestErrorText(error): string {
  const status = requestErrorStatus(error);
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

// The same text as a node for display: the sign-in link accompanies a 401.
export function requestErrorDescription(error): ReactNode {
  const status = requestErrorStatus(error);
  if (status !== null) {
    return jsxErrorMessage(status, error.response.statusText ?? '');
  }

  return requestErrorText(error);
}
