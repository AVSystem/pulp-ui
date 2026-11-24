import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { debPublication } from 'src/entities/deb/publication';
import { filePublication } from 'src/entities/file/publication';
import { rpmPublication } from 'src/entities/rpm/publication';
import { server } from 'src/test-utils/server';

const API = '/pulp/api/v3';
const TASK = `${API}/tasks/00000000-0000-4000-8000-00000000a001/`;
const REPOSITORY = `${API}/repositories/file/file/00000000-0000-4000-8000-000000000001/`;
const VERSION = `${REPOSITORY}versions/3/`;

// The body of every request a collection receives, answered with a task.
function acceptingAt(path: string) {
  const bodies: unknown[] = [];
  server.use(
    http.post(`*${API}/publications/${path}/`, async ({ request }) => {
      bodies.push(await request.json());
      return HttpResponse.json({ task: TASK }, { status: 202 });
    }),
  );
  return bodies;
}

describe('Unit: creating publications', { tags: ['unit'] }, () => {
  it('sends the repository for its latest version and answers the address of the task', async () => {
    const bodies = acceptingAt('file/file');

    const task = await filePublication.create?.({ repository: REPOSITORY });

    expect(task).toBe(TASK);
    expect(bodies).toEqual([{ repository: REPOSITORY }]);
  });

  it('sends one version with the chosen options and nothing else', async () => {
    const bodies = acceptingAt('file/file');

    await filePublication.create?.({
      repository_version: VERSION,
      manifest: 'INDEX',
      sha256sums: 'root',
    });

    expect(bodies).toEqual([
      { repository_version: VERSION, manifest: 'INDEX', sha256sums: 'root' },
    ]);
  });

  it('posts to the collection of each plugin that publishes', async () => {
    const deb = acceptingAt('deb/apt');
    const rpm = acceptingAt('rpm/rpm');

    await debPublication.create?.({ repository: REPOSITORY, simple: true });
    await rpmPublication.create?.({
      repository: REPOSITORY,
      compression_type: 'gz',
    });

    expect(deb).toEqual([{ repository: REPOSITORY, simple: true }]);
    expect(rpm).toEqual([{ repository: REPOSITORY, compression_type: 'gz' }]);
  });

  it('rejects with the server refusal, so a repository without a version is explained', async () => {
    server.use(
      http.post(`*${API}/publications/file/file/`, () =>
        HttpResponse.json(
          {
            non_field_errors: [
              'Repository has no version available to create Publication from',
            ],
          },
          { status: 400 },
        ),
      ),
    );

    await expect(
      filePublication.create?.({ repository: REPOSITORY }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});
