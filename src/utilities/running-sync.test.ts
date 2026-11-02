import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { listOf, repository, task } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { isSyncTask, runningTask } from './running-sync';

const TASKS = '/pulp/api/v3/tasks/';
const FILE_SYNC = 'pulp_file.app.tasks.synchronizing.synchronize';

describe('runningTask', () => {
  it('asks the task list for the oldest waiting or running task holding the repository', async () => {
    const repo = repository();
    const { handler, queries } = listOf(TASKS, []);
    server.use(handler);

    await expect(runningTask(repo.pulp_href, 'file')).resolves.toBeNull();

    expect(queries).toHaveLength(1);
    expect(queries[0].get('exclusive_resources')).toBe(repo.pulp_href);
    expect(queries[0].get('state__in')).toBe('waiting,running');
    expect(queries[0].get('ordering')).toBe('pulp_created');
    expect(queries[0].get('limit')).toBe('1');
    expect(queries[0].get('offset')).toBe('0');
  });

  it('describes a running sync task of the plugin', async () => {
    const repo = repository();
    const running = task({ state: 'running', name: FILE_SYNC });
    server.use(listOf(TASKS, [running]).handler);

    await expect(runningTask(repo.pulp_href, 'file')).resolves.toStrictEqual({
      pulp_href: running.pulp_href,
      name: FILE_SYNC,
      state: 'running',
      isSync: true,
    });
  });

  it('describes a waiting task of another name as not a sync', async () => {
    const repo = repository();
    const waiting = task({ state: 'waiting', name: 'pulp_file.app.tasks.x' });
    server.use(listOf(TASKS, [waiting]).handler);

    await expect(runningTask(repo.pulp_href, 'file')).resolves.toMatchObject({
      name: 'pulp_file.app.tasks.x',
      state: 'waiting',
      isSync: false,
    });
  });

  it('lets a failed request reach the caller', async () => {
    server.use(
      http.get(`*${TASKS}`, () =>
        HttpResponse.json({ detail: 'broken' }, { status: 500 }),
      ),
    );

    await expect(runningTask(repository().pulp_href, 'file')).rejects.toThrow();
  });
});

describe('isSyncTask', () => {
  it.each([
    ['file', FILE_SYNC],
    ['rpm', 'pulp_rpm.app.tasks.synchronizing.synchronize'],
    ['python', 'pulp_python.app.tasks.sync.sync'],
    ['deb', 'pulp_deb.app.tasks.synchronizing.synchronize'],
  ] as const)('knows the sync task of %s', (plugin, name) => {
    expect(isSyncTask(plugin, name)).toBe(true);
  });

  it('does not take the sync task of one plugin for another plugin', () => {
    expect(isSyncTask('rpm', FILE_SYNC)).toBe(false);
  });
});
