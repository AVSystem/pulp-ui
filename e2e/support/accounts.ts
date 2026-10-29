import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Accounts of a remote run. They are read from the JSON file named by
// PULP_UI_E2E_ACCOUNTS ({"admin": {"username", "password"}, "viewer": {...}})
// and nowhere else; the file and its contents are never logged or copied.

export type Role = 'admin' | 'viewer';

export interface Credentials {
  username: string;
  password: string;
}

const roles: Role[] = ['admin', 'viewer'];

function missing(detail: string): Error {
  return new Error(
    `PULP_UI_E2E_ACCOUNTS ${detail}. Remote end-to-end tests read their ` +
      'accounts from a JSON file given by this variable, shaped like ' +
      '{"admin": {"username", "password"}, "viewer": {"username", "password"}}.',
  );
}

export function accountsFile(): string {
  const path = process.env['PULP_UI_E2E_ACCOUNTS'];
  if (!path) {
    throw missing('is not set');
  }
  return path;
}

export function account(role: Role): Credentials {
  const path = accountsFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // The reason is left out on purpose: a parse error can quote the file.
    throw missing('does not name a readable JSON file');
  }

  const entry = (parsed as Record<string, Partial<Credentials> | undefined>)[
    role
  ];
  if (
    !entry ||
    typeof entry.username !== 'string' ||
    typeof entry.password !== 'string' ||
    !entry.username ||
    !entry.password
  ) {
    throw missing(`has no complete "${role}" entry`);
  }
  return { username: entry.username, password: entry.password };
}

export function allRoles(): Role[] {
  return roles;
}

// Where the saved browser session of a role lives. The directory is ignored by
// git; the files hold live session cookies and exist only during a run.
export function storageStatePath(role: Role): string {
  return join('playwright', '.auth', `${role}.json`);
}
