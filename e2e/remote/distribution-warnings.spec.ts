import { test } from '@playwright/test';
import {
  expectDetailState,
  expectListStates,
  expectTabState,
} from '../support/serving-checks';
import { ADMIN_STATES } from '../support/serving-states';

// What the administrator is told about the served state of the lab's serving
// distributions, one for every state a distribution can serve in. The same
// objects are read on the list, on the page of each distribution and on the
// Distributions tab of the repository it serves; this spec writes nothing.

test('the list shows the served state of every serving distribution', async ({
  page,
}) => {
  await expectListStates(page, ADMIN_STATES);
});

for (const state of ADMIN_STATES) {
  test(`the page of ${state.name} shows ${state.warning ?? 'no warning'}`, async ({
    page,
  }) => {
    await expectDetailState(page, state);
  });
}

for (const state of ADMIN_STATES.filter(({ onTab }) => onTab)) {
  test(`the tab of the repository of ${state.name} shows ${state.warning ?? 'no warning'}`, async ({
    page,
  }) => {
    await expectTabState(page, state);
  });
}
