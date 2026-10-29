// Settings of an end-to-end run, read from the environment on demand. A test
// that needs one fails with a message naming the missing variable instead of
// running against a default host or account.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. End-to-end tests read their target and account from ` +
        'the environment only: PULP_UI_E2E_BASE_URL (UI root, ending in /ui/), ' +
        'PULP_UI_E2E_USERNAME and PULP_UI_E2E_PASSWORD.',
    );
  }
  return value;
}

export function baseUrl(): string {
  const value = required('PULP_UI_E2E_BASE_URL');
  if (!value.endsWith('/ui/')) {
    throw new Error(
      `PULP_UI_E2E_BASE_URL must end in /ui/ so relative navigation keeps the UI prefix, got ${value}`,
    );
  }
  return value;
}

export function account(): { username: string; password: string } {
  return {
    username: required('PULP_UI_E2E_USERNAME'),
    password: required('PULP_UI_E2E_PASSWORD'),
  };
}

// The origin (scheme, host and port) the UI is served from. The API lives under
// the same origin, so API calls made by a test are built from it.
export function origin(): string {
  return new URL(baseUrl()).origin;
}
