import { t } from '@lingui/core/macro';
import { LoginLink } from '../components/login-link';
import { mapErrorMessages } from './map-error-messages';
import { isSessionEnd, requestErrorStatus } from './request-error';

export function errorMessage(
  statusCode: number,
  statusText: string,
  customMessage?: string,
) {
  const messages = {
    500: t`Error ${statusCode} - ${statusText}: The server encountered an error and was unable to complete your request.`,
    401: t`Error ${statusCode} - ${statusText}: You do not have the required permissions to proceed with this request. Please contact the server administrator for elevated permissions.`,
    403: t`Error ${statusCode} - ${statusText}: Forbidden: You do not have the required permissions to proceed with this request. Please contact the server administrator for elevated permissions.`,
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
  const description = errorMessage(code, text, custom);

  if (code == 401) {
    return (
      <>
        {description}
        <br />
        <LoginLink />
      </>
    );
  }

  return description;
}

// Turns a failed request into a danger alert and then calls the callback. The
// end of a session adds no alert: the sign-in dialog explains it, and a second
// message with the old 401 sentence would only stack up behind the dialog.
export const handleHttpError = (title, callback, addAlert) => (e) => {
  if (isSessionEnd(e)) {
    callback();
    return;
  }

  let description = String(e);

  const status = requestErrorStatus(e);
  if (status !== null) {
    // HTTP error
    const err = mapErrorMessages(e);
    const message = Object.values(err).join(' ');

    description = jsxErrorMessage(status, e.response.statusText, message);
  }

  addAlert({
    title,
    variant: 'danger',
    description,
  });

  callback();
};
