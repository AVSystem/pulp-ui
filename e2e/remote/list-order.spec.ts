import { expect, test } from '@playwright/test';
import { apiContext } from '../support/api';
import { title } from '../support/sign-in';

// A list opens ordered by name, the way the server orders it, so the first
// repository a person sees is the alphabetically first one, and a form says
// which field it cannot be saved without.

test('the file repository list opens with the repositories in the order the server sorts them by name', async ({
  page,
}) => {
  const api = await apiContext();
  const names = async (params: Record<string, string>) => {
    const response = await api.get('/pulp/api/v3/repositories/file/file/', {
      params: { ...params, ordering: 'name', fields: 'name' },
    });
    expect(response.ok(), 'the API list').toBe(true);
    return (
      (await response.json()) as { results: { name: string }[] }
    ).results.map(({ name }) => name);
  };

  try {
    await page.goto('file/repositories');
    await expect(title(page, 'Repositories')).toBeVisible();
    const links = page.locator('tbody tr td:first-child a');
    await expect(links.first()).toBeVisible();

    // Other specs create repositories while this one runs, so the rows shown
    // are compared with the server's order of exactly those names, and the
    // top row with the server's first name.
    const shown = await links.allInnerTexts();
    expect(shown.length, 'rows shown').toBeGreaterThan(1);
    expect(shown, 'the rows, top to bottom').toEqual(
      await names({ name__in: shown.join(','), limit: '100' }),
    );
    expect(shown[0], 'the top row').toBe((await names({ limit: '1' }))[0]);
  } finally {
    await api.dispose();
  }
});

test('the file repository add form marks Name as required and keeps Save disabled while it is empty', async ({
  page,
}) => {
  await page.goto('file/repositories/edit/_');
  await expect(title(page, 'Add new repository')).toBeVisible();

  const nameGroup = page.locator('.pf-v5-c-form__group', {
    has: page.locator('#name'),
  });
  await expect(
    nameGroup.locator('.pf-v5-c-form__label-required'),
    'the required marker of Name',
  ).toBeVisible();

  const save = page.getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();

  await page.locator('#name').fill('zz-e2e-not-saved');
  await expect(save).toBeEnabled();
  await page.locator('#name').fill('');
  await expect(save).toBeDisabled();
});
