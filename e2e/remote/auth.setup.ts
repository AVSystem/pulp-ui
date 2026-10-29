import { expect, test as setup } from '@playwright/test';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account, allRoles, storageStatePath } from '../support/accounts';
import { origin } from '../support/env';

// Signs each account in once, through the login API like the application does
// (UTF-8 Basic header, X-Requested-With), and saves the resulting session as a
// browser storage state. Projects that need a signed-in browser load it, so no
// test types a password into a form just to get a session.
for (const role of allRoles()) {
  setup(`sign in as the ${role} account`, async ({ request }) => {
    const { username, password } = account(role);

    const response = await request.post(`${origin()}/pulp/api/v3/login/`, {
      headers: {
        Authorization: basicAuthorization(username, password),
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    expect(response.status(), `sign in as the ${role} account`).toBe(201);

    const path = storageStatePath(role);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    await request.storageState({ path });
    // The file holds live session cookies: owner access only.
    chmodSync(path, 0o600);
  });
}
