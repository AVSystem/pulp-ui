import { test } from '@playwright/test';
import {
  expectDetailState,
  expectListStates,
  expectTabState,
} from '../support/serving-checks';
import { VIEWER_STATES } from '../support/serving-states';

// What the read-only viewer is told about the same serving distributions. The
// viewer may read file distributions and may not read any publication, so a
// state that depends on the publications is shown as "Cannot be checked" and
// never as a distribution that serves nothing or is out of date; a state that
// does not depend on them is told as to everyone. This spec writes nothing.

test('the list shows the served state of every serving distribution the viewer may read', async ({
  page,
}) => {
  await expectListStates(page, VIEWER_STATES);
});

for (const state of VIEWER_STATES) {
  test(`the page of ${state.name} shows ${state.warning ?? 'no warning'}`, async ({
    page,
  }) => {
    await expectDetailState(page, state);
  });
}

for (const state of VIEWER_STATES.filter(({ onTab }) => onTab)) {
  test(`the tab of the repository of ${state.name} shows ${state.warning ?? 'no warning'}`, async ({
    page,
  }) => {
    await expectTabState(page, state);
  });
}
