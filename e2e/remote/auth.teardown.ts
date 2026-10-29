import { test as teardown } from '@playwright/test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { allRoles, storageStatePath } from '../support/accounts';
import { origin } from '../support/env';

// Ends the sessions the setup project created and deletes their storage state
// files, so no live session cookie stays on disk after a run. A session that
// is already gone (401) is the state this aims for.
for (const role of allRoles()) {
  teardown(`sign out the ${role} session`, async ({ playwright }) => {
    const path = storageStatePath(role);
    if (!existsSync(path)) {
      return;
    }

    try {
      const state = JSON.parse(readFileSync(path, 'utf8')) as {
        cookies: { name: string; value: string }[];
      };
      const csrf = state.cookies.find((c) => c.name === 'csrftoken')?.value;
      const context = await playwright.request.newContext({
        storageState: path,
      });
      try {
        const response = await context.delete(
          `${origin()}/pulp/api/v3/login/`,
          {
            headers: {
              'X-Requested-With': 'XMLHttpRequest',
              'X-CSRFToken': csrf ?? '',
              // a secure-origin CSRF check wants to know where the call comes from
              Origin: origin(),
              Referer: `${origin()}/`,
            },
          },
        );
        if (![204, 401].includes(response.status())) {
          throw new Error(
            `signing out the ${role} session answered ${response.status()}`,
          );
        }
      } finally {
        await context.dispose();
      }
    } finally {
      rmSync(path, { force: true });
    }
  });
}
