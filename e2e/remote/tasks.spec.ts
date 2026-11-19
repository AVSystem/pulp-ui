import { expect, test } from '@playwright/test';
import {
  getRepositoriesFileFileDeleteUrl,
  getRepositoriesFileFileListUrl,
} from '@pulp-ui/sdk/file/repositories-file';
import { TestObjects } from '../support/api';
import { apiDelete } from '../support/sdk-request';
import { title } from '../support/sign-in';

// A task a person follows from the task list to its page: the list shows it,
// the status filter narrows the list, opening it lands on its own address, and
// the address older links use ends on the new one. The task is made by the
// set-up: deleting a repository is a task of its own, and it finishes within
// moments.

let objects: TestObjects;
let taskId = '';

test.beforeAll(async () => {
  test.setTimeout(180_000);
  objects = await TestObjects.open('tasks');
  const repository = await objects.create(getRepositoriesFileFileListUrl(), {
    name: objects.name('doomed'),
  });
  const answer = await apiDelete(
    objects.api,
    getRepositoriesFileFileDeleteUrl(repository.pulp_href),
  );
  expect(answer.status, 'the answer to the delete').toBe(202);
  const taskHref = answer.body?.task as string;
  await objects.waitForTask(taskHref);
  taskId = taskHref.split('/').filter(Boolean).pop() as string;
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await objects.cleanUp();
});

test('a finished task is listed, found by its status, opened at its own address and reached from the old one', async ({
  page,
}) => {
  const link = () => page.locator(`a[href*="/tasks/${taskId}"]`);
  const completedOnPage = () =>
    page.getByText('Completed', { exact: true }).first();

  // the list, newest first, wide enough that concurrent work cannot push the
  // task off the first page
  await page.goto('tasks?page_size=100');
  await expect(title(page, 'Task management')).toBeVisible();
  await expect(link()).toBeVisible();

  // the status filter: a failed-only list does not hold a task that completed,
  // a completed-only list does
  const filter = page.locator('[data-cy=compound_filter]');
  const chooseStatus = async (status: 'Failed' | 'Completed') => {
    await filter.getByRole('button', { name: 'Task name' }).click();
    await page.getByRole('menuitem', { name: 'Status', exact: true }).click();
    await filter.getByRole('button', { name: 'Status', exact: true }).click();
    await page.getByRole('option', { name: status, exact: true }).click();
  };
  await chooseStatus('Failed');
  await expect(page).toHaveURL(/state=failed/);
  await expect(link()).toHaveCount(0);

  await page.goto('tasks?page_size=100');
  await chooseStatus('Completed');
  await expect(page).toHaveURL(/state=completed/);
  await expect(link()).toBeVisible();

  // opening the task lands on its address and shows how it ended
  await link().click();
  await expect(page).toHaveURL(new RegExp(`/ui/tasks/${taskId}/?$`));
  await expect(completedOnPage()).toBeVisible();

  // the address links used before tasks had their own address ends on the new
  // one
  await page.goto(`tasks/detail/${taskId}`);
  await expect(page).toHaveURL(new RegExp(`/ui/tasks/${taskId}/?$`));
  await expect(completedOnPage()).toBeVisible();
});
