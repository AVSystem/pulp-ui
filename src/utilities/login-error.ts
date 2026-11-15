import { t } from '@lingui/core/macro';

// The sentence that tells a user why a sign-in request failed. The message is
// built when called, because the catalog is not active when a module loads.
export function loginErrorMessage(error): string {
  const response = error?.response;
  if (!response) {
    const message = error?.message || String(error);
    return t`The server could not be reached: ${message}`;
  }
  if (response.status.toString().startsWith('5')) {
    return t`Server error. Please come back later.`;
  }
  return response.data?.detail || t`Invalid login credentials.`;
}
