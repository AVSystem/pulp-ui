import { t } from '@lingui/core/macro';
import { type ReactNode } from 'react';
import { mapErrorMessages } from './map-error-messages';
import {
  forbiddenTexts,
  isSessionEnd,
  requestErrorStatus,
} from './request-error';

export function errorMessage(
  statusCode: number,
  statusText: string,
  customMessage?: string,
) {
  const messages = {
    500: t`Error ${statusCode} - ${statusText}: The server encountered an error and was unable to complete your request.`,
    404: t`Error ${statusCode} - ${statusText}: The server could not find the requested URL.`,
    400: t`Error ${statusCode} - ${statusText}: The server was unable to complete your request.`,
    default: t`Error ${statusCode} - ${statusText}`,
    custom: t`Error ${statusCode} - ${statusText}: ${customMessage}`,
  };
  if (customMessage) {
    return messages.custom;
  }
  return messages[statusCode] || messages.default;
}

export function jsxErrorMessage(code, text, custom?) {
  return errorMessage(code, text, custom);
}

// What a refused action says: that the user may not do it, Pulp's own reason
// as plain text that wraps inside the alert, and whom to ask. The reason is a
// text node, never markup.
export function forbiddenDescription(error) {
  const { sentence, detail, hint } = forbiddenTexts(error);

  return (
    <>
      <p>{sentence}</p>
      <p className='pulp-break-anywhere'>{detail}</p>
      <p>{hint}</p>
    </>
  );
}

// Turns a failed request into a danger alert and then calls the callback. The
// end of a session adds no alert: the sign-in dialog explains it, and a second
// message with the old 401 sentence would only stack up behind the dialog.
export const handleHttpError = (title, callback, addAlert) => (e) => {
  if (isSessionEnd(e)) {
    callback();
    return;
  }

  let description: ReactNode = String(e);
  let id: string | undefined;

  const status = requestErrorStatus(e);
  if (status === 403) {
    // The same refusal of the same action stays one alert while it is open.
    description = forbiddenDescription(e);
    id = `refused:${title}`;
  } else if (status !== null) {
    // HTTP error
    const err = mapErrorMessages(e);
    const message = Object.values(err).join(' ');

    description = jsxErrorMessage(status, e.response.statusText, message);
  }

  addAlert({
    ...(id ? { id } : {}),
    title,
    variant: 'danger',
    description,
  });

  callback();
};
