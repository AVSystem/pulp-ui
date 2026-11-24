import { describe, expect, it } from 'vitest';
import { debPackage } from 'src/entities/deb/package';
import { fileContent } from 'src/entities/file/content';
import { fileRepository } from 'src/entities/file/repository';
import { pythonPackage } from 'src/entities/python/package';
import { rpmPackage } from 'src/entities/rpm/package';
import { readTaskToEnd } from 'src/framework/task-end';
import { uploadLab } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { UPLOAD_LIMITS, uploadFile } from './upload-file';
import {
  type UploadOutcome,
  type WaitForTask,
  uploadFiles,
} from './upload-files';

const MIB = 1024 * 1024;
const REPOSITORY =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-0000000000a1/';

// A file of the size, without filling it with anything: the content is never
// read, only sliced and sent.
const fileOf = (bytes: number, name = 'big.bin') =>
  new File([new Uint8Array(bytes)], name);

describe(
  'Integration: one file into a repository, as one request or in chunks',
  { tags: ['integration'] },
  () => {
    it('keeps the thresholds in one place', () => {
      expect(UPLOAD_LIMITS).toStrictEqual({
        chunkAbove: 8 * MIB,
        chunkBytes: 4 * MIB,
        chunksInFlight: 3,
        filesInFlight: 2,
      });
    });

    it('sends a small file as one content create with the file, its path and the repository, and answers the task', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);

      const task = await uploadFile({
        file: fileOf(MIB, 'small.bin'),
        contentEntity: fileContent,
        fields: { relative_path: 'small.bin' },
        repository: REPOSITORY,
        mayChunk: true,
      });

      expect(task).toMatch(/^\/pulp\/api\/v3\/tasks\//);
      expect(lab.uploads).toHaveLength(0);
      expect(lab.creates).toStrictEqual([
        {
          fields: { relative_path: 'small.bin', repository: REPOSITORY },
          fileBytes: MIB,
        },
      ]);
    });

    it('leaves the repository out of the create when none is given', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);

      await uploadFile({
        file: fileOf(10),
        contentEntity: fileContent,
        fields: { relative_path: 'a.txt' },
        mayChunk: true,
      });

      expect(lab.creates[0].fields).toStrictEqual({ relative_path: 'a.txt' });
    });

    it('sends a file of exactly the threshold as one request: only a larger file is chunked', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);

      await uploadFile({
        file: fileOf(UPLOAD_LIMITS.chunkAbove),
        contentEntity: fileContent,
        fields: { relative_path: 'edge.bin' },
        repository: REPOSITORY,
        mayChunk: true,
      });

      expect(lab.uploads).toHaveLength(0);
      expect(lab.creates).toHaveLength(1);
    });

    it('sends a large file through an upload in chunks of 4 MiB, at most three at a time, then creates the content from the upload', async () => {
      const lab = uploadLab({ chunkMs: 25 });
      server.use(...lab.handlers);
      const progress: { sent: number; total: number }[] = [];

      const task = await uploadFile({
        file: fileOf(20 * MIB),
        contentEntity: fileContent,
        fields: { relative_path: 'big.bin' },
        repository: REPOSITORY,
        mayChunk: true,
        onProgress: (value) => progress.push(value),
      });

      expect(lab.uploads).toHaveLength(1);
      expect(lab.uploads[0].size).toBe(20 * MIB);
      expect(lab.chunks.map(({ range }) => range).sort()).toStrictEqual(
        [
          'bytes 0-4194303/20971520',
          'bytes 4194304-8388607/20971520',
          'bytes 8388608-12582911/20971520',
          'bytes 12582912-16777215/20971520',
          'bytes 16777216-20971519/20971520',
        ].sort(),
      );
      expect(lab.chunks.every(({ bytes }) => bytes === 4 * MIB)).toBe(true);
      expect(
        lab.chunks.every(({ upload }) => upload === lab.uploads[0].href),
      ).toBe(true);
      expect(lab.state.maxInFlight).toBe(3);

      // the create names the finished upload and carries no file
      expect(lab.creates).toStrictEqual([
        {
          fields: {
            relative_path: 'big.bin',
            repository: REPOSITORY,
            upload: lab.uploads[0].href,
          },
          fileBytes: null,
        },
      ]);
      expect(lab.events[0]).toBe('upload-create');
      expect(lab.events.at(-1)).toBe('content-create big.bin');
      expect(lab.events.filter((event) => event === 'modify')).toHaveLength(0);
      expect(lab.removed).toHaveLength(0);
      expect(task).toMatch(/^\/pulp\/api\/v3\/tasks\//);

      // one report per finished chunk, growing to the whole file
      expect(progress).toHaveLength(5);
      expect(progress.map(({ sent }) => sent)).toStrictEqual([
        4 * MIB,
        8 * MIB,
        12 * MIB,
        16 * MIB,
        20 * MIB,
      ]);
      expect(progress.every(({ total }) => total === 20 * MIB)).toBe(true);
    });

    it('gives the last chunk the bytes that are left', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);

      await uploadFile({
        file: fileOf(9 * MIB),
        contentEntity: fileContent,
        fields: { relative_path: 'odd.bin' },
        mayChunk: true,
      });

      expect(lab.chunks.map(({ range }) => range).sort()).toStrictEqual(
        [
          'bytes 0-4194303/9437184',
          'bytes 4194304-8388607/9437184',
          'bytes 8388608-9437183/9437184',
        ].sort(),
      );
      expect(lab.chunks.map(({ bytes }) => bytes).sort()).toStrictEqual(
        [MIB, 4 * MIB, 4 * MIB].sort(),
      );
    });

    it('sends the same large file as one request when the user may not create uploads', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);

      await uploadFile({
        file: fileOf(20 * MIB),
        contentEntity: fileContent,
        fields: { relative_path: 'big.bin' },
        repository: REPOSITORY,
        mayChunk: false,
      });

      expect(lab.uploads).toHaveLength(0);
      expect(lab.chunks).toHaveLength(0);
      expect(lab.creates).toHaveLength(1);
      expect(lab.creates[0].fileBytes).toBe(20 * MIB);
    });

    it("stops sending chunks when one fails, deletes the upload and rejects with the server's answer", async () => {
      const lab = uploadLab({
        chunkMs: 40,
        refuseChunk: (start) => (start === 0 ? 'chunk refused' : undefined),
      });
      server.use(...lab.handlers);

      await expect(
        uploadFile({
          file: fileOf(20 * MIB),
          contentEntity: fileContent,
          fields: { relative_path: 'big.bin' },
          repository: REPOSITORY,
          mayChunk: true,
        }),
      ).rejects.toMatchObject({ response: { status: 400 } });

      expect(lab.removed).toStrictEqual([lab.uploads[0].href]);
      // the first three were started; the fourth and fifth never were
      expect(lab.chunks.length).toBeLessThanOrEqual(3);
      expect(lab.creates).toHaveLength(0);
      expect(lab.events.at(-1)).toBe('upload-delete');
    });

    it('deletes the upload and rejects when the caller cancels in the middle', async () => {
      const lab = uploadLab({ chunkMs: 10 });
      server.use(...lab.handlers);
      const controller = new AbortController();

      await expect(
        uploadFile({
          file: fileOf(20 * MIB),
          contentEntity: fileContent,
          fields: { relative_path: 'big.bin' },
          mayChunk: true,
          signal: controller.signal,
          onProgress: () => controller.abort(),
        }),
      ).rejects.toBeDefined();

      expect(lab.removed).toStrictEqual([lab.uploads[0].href]);
      expect(lab.creates).toHaveLength(0);
      expect(lab.chunks.length).toBeLessThan(5);
    });

    it('sends nothing when the caller cancelled before the start', async () => {
      const lab = uploadLab();
      server.use(...lab.handlers);
      const controller = new AbortController();
      controller.abort();

      await expect(
        uploadFile({
          file: fileOf(20 * MIB),
          contentEntity: fileContent,
          fields: { relative_path: 'big.bin' },
          mayChunk: true,
          signal: controller.signal,
        }),
      ).rejects.toBeDefined();

      expect(lab.events).toStrictEqual([]);
    });

    it('deletes the upload when the content create after the chunks is refused', async () => {
      const lab = uploadLab({ refuseCreate: () => 'No such repository.' });
      server.use(...lab.handlers);

      await expect(
        uploadFile({
          file: fileOf(10 * MIB),
          contentEntity: fileContent,
          fields: { relative_path: 'big.bin' },
          repository: REPOSITORY,
          mayChunk: true,
        }),
      ).rejects.toMatchObject({ response: { status: 400 } });

      expect(lab.removed).toStrictEqual([lab.uploads[0].href]);
    });

    it('does not delete anything when a single request fails: there is no upload', async () => {
      const lab = uploadLab({ refuseCreate: () => 'No such repository.' });
      server.use(...lab.handlers);

      await expect(
        uploadFile({
          file: fileOf(MIB),
          contentEntity: fileContent,
          fields: { relative_path: 'a.bin' },
          repository: REPOSITORY,
          mayChunk: true,
        }),
      ).rejects.toMatchObject({ response: { status: 400 } });

      expect(lab.removed).toHaveLength(0);
    });
  },
);

const wait: WaitForTask = (task, { signal }) =>
  readTaskToEnd(task, { signal, pollMs: 5 });

const names = ['a.bin', 'b.bin', 'c.bin'];
const itemsOf = (list: string[], bytes = 1000) =>
  list.map((name) => ({ file: fileOf(bytes, name) }));
const kinds = (results: { outcome: UploadOutcome }[]) =>
  results.map(({ outcome }) => outcome.kind);

describe(
  'Integration: several files into one repository',
  { tags: ['integration'] },
  () => {
    describe('for a superuser, who gets one version for all of them', () => {
      const run = (
        overrides: Partial<Parameters<typeof uploadFiles>[0]> = {},
      ) =>
        uploadFiles({
          items: itemsOf(names),
          contentEntity: fileContent,
          repository: REPOSITORY,
          repositoryEntity: fileRepository,
          superuser: true,
          mayChunk: true,
          waitForTask: wait,
          ...overrides,
        });

      it('creates every file without a repository and then adds all the content with one modify request', async () => {
        const lab = uploadLab({ createMs: 20 });
        server.use(...lab.handlers);

        const { results, add } = await run();

        expect(lab.creates).toHaveLength(3);
        expect(
          lab.creates.every(({ fields }) => !('repository' in fields)),
        ).toBe(true);
        expect(
          lab.creates.map(({ fields }) => fields['relative_path']).sort(),
        ).toStrictEqual(names);
        expect(lab.state.maxCreates).toBe(2);

        expect(lab.modifies).toHaveLength(1);
        expect(lab.modifies[0].href).toBe(`${REPOSITORY}modify/`);
        // the body holds the three content addresses and nothing else: no
        // base version
        expect(lab.modifies[0].body).toStrictEqual({
          add_content_units: expect.arrayContaining(lab.contentHrefs),
        });
        expect(
          (lab.modifies[0].body as { add_content_units: string[] })
            .add_content_units,
        ).toHaveLength(3);
        expect(lab.events.at(-1)).toBe('modify');

        expect(kinds(results)).toStrictEqual(['created', 'created', 'created']);
        expect(add).toStrictEqual({
          kind: 'started',
          task: expect.stringMatching(/^\/pulp\/api\/v3\/tasks\//),
        });
      });

      it("adds nothing when one file fails, and names the failed file with the server's reason", async () => {
        const lab = uploadLab({
          failTask: ({ fields }) =>
            fields['relative_path'] === 'b.bin'
              ? 'Could not read b.'
              : undefined,
        });
        server.use(...lab.handlers);

        const { results, add } = await run();

        expect(lab.modifies).toHaveLength(0);
        expect(lab.events).not.toContain('modify');
        expect(add).toBeUndefined();
        expect(results.map(({ file }) => file.name)).toStrictEqual(names);
        expect(results[1].outcome).toStrictEqual({
          kind: 'failed',
          reason: 'Could not read b.',
        });
        // the two others exist as content, but are not in the repository
        expect(kinds(results)).toStrictEqual(['created', 'failed', 'created']);
        expect(lab.contentHrefs).toHaveLength(2);
      });

      it('adds nothing when the server refuses a create, and gives its text as written', async () => {
        const lab = uploadLab({
          refuseCreate: ({ fields }) =>
            fields['relative_path'] === 'a.bin'
              ? 'Path not allowed.'
              : undefined,
        });
        server.use(...lab.handlers);

        const { results, add } = await run();

        expect(lab.modifies).toHaveLength(0);
        expect(add).toBeUndefined();
        expect(results[0].outcome).toStrictEqual({
          kind: 'failed',
          reason: 'Path not allowed.',
        });
        expect(kinds(results).slice(1)).toStrictEqual(['created', 'created']);
      });

      it('adds nothing for a file whose task made no content', async () => {
        const lab = uploadLab({ emptyTask: true });
        server.use(...lab.handlers);

        const { results, add } = await run({ items: itemsOf(['a.bin']) });

        expect(kinds(results)).toStrictEqual(['no-content']);
        expect(lab.modifies).toHaveLength(0);
        expect(add).toBeUndefined();
      });

      it("reports a refused modify with the server's reason", async () => {
        const lab = uploadLab({ refuseModify: 'Repository is gone.' });
        server.use(...lab.handlers);

        const { results, add } = await run();

        expect(kinds(results)).toStrictEqual(['created', 'created', 'created']);
        expect(add).toStrictEqual({
          kind: 'failed',
          reason: 'Repository is gone.',
        });
      });

      it('adds each unit of content once when two files made the same content', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const content =
          '/pulp/api/v3/content/file/files/00000000-0000-4000-8000-0000000000c1/';

        await run({
          waitForTask: async () => ({ state: 'completed', created: [content] }),
        });

        expect(lab.modifies[0].body).toStrictEqual({
          add_content_units: [content],
        });
      });

      it('does not add anything when a task is still unfinished', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);

        const { results, add } = await run({
          items: itemsOf(['a.bin']),
          waitForTask: async () => ({ state: 'pending' }),
        });

        expect(results[0].outcome).toStrictEqual({
          kind: 'unfinished',
          task: expect.stringMatching(/^\/pulp\/api\/v3\/tasks\//),
          why: 'pending',
        });
        expect(add).toBeUndefined();
        expect(lab.modifies).toHaveLength(0);
      });

      it('sends a large file through an upload and still adds it without a repository on the create', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const progress: [number, number][] = [];

        const { results } = await run({
          items: [{ file: fileOf(10 * MIB, 'big.bin') }],
          onProgress: (index, { sent }) => progress.push([index, sent]),
        });

        expect(lab.uploads).toHaveLength(1);
        expect(lab.creates).toStrictEqual([
          {
            fields: { relative_path: 'big.bin', upload: lab.uploads[0].href },
            fileBytes: null,
          },
        ]);
        expect(lab.events.at(-1)).toBe('modify');
        expect(kinds(results)).toStrictEqual(['created']);
        expect(progress.map(([index]) => index)).toStrictEqual([0, 0, 0]);
      });

      it('refuses at once, before anything is sent, for a repository kind that cannot be modified', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);

        await expect(run({ repositoryEntity: {} })).rejects.toThrow(
          /no modify/,
        );
        expect(lab.events).toStrictEqual([]);
      });

      it('sends nothing when nothing was chosen', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);

        const { results, add } = await run({ items: [] });

        expect(results).toStrictEqual([]);
        expect(add).toBeUndefined();
        expect(lab.events).toStrictEqual([]);
      });
    });

    describe('for everyone else, who gets one version per file', () => {
      const run = (
        overrides: Partial<Parameters<typeof uploadFiles>[0]> = {},
      ) =>
        uploadFiles({
          items: itemsOf(names),
          contentEntity: fileContent,
          repository: REPOSITORY,
          repositoryEntity: fileRepository,
          superuser: false,
          mayChunk: false,
          waitForTask: wait,
          ...overrides,
        });

      it('creates every file with the repository, two at a time, and answers a task per file', async () => {
        const lab = uploadLab({ createMs: 20 });
        server.use(...lab.handlers);
        const settled: number[] = [];

        const { results, add } = await run({
          onSettled: (index) => settled.push(index),
        });

        expect(lab.creates).toHaveLength(3);
        expect(
          lab.creates.every(
            ({ fields }) => fields['repository'] === REPOSITORY,
          ),
        ).toBe(true);
        expect(lab.state.maxCreates).toBe(2);
        expect(lab.modifies).toHaveLength(0);
        expect(add).toBeUndefined();
        expect(kinds(results)).toStrictEqual(['started', 'started', 'started']);
        expect(
          new Set(
            results.map(({ outcome }) => (outcome as { task: string }).task),
          ).size,
        ).toBe(3);
        expect(settled.sort()).toStrictEqual([0, 1, 2]);
      });

      it("goes on with the other files when one fails, and gives that file the server's reason", async () => {
        const lab = uploadLab({
          refuseCreate: ({ fields }) =>
            fields['relative_path'] === 'b.bin'
              ? 'Not allowed here.'
              : undefined,
        });
        server.use(...lab.handlers);

        const { results } = await run();

        expect(lab.creates).toHaveLength(3);
        expect(kinds(results)).toStrictEqual(['started', 'failed', 'started']);
        expect(results[1].outcome).toStrictEqual({
          kind: 'failed',
          reason: 'Not allowed here.',
        });
      });

      it('sends a large file as one request, as the user may not create uploads', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);

        await run({ items: [{ file: fileOf(10 * MIB, 'big.bin') }] });

        expect(lab.uploads).toHaveLength(0);
        expect(lab.creates[0].fileBytes).toBe(10 * MIB);
      });

      it('sends nothing for any file when the caller canceled before the start', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);
        const controller = new AbortController();
        controller.abort();

        const { results } = await run({ signal: controller.signal });

        expect(kinds(results)).toStrictEqual([
          'not-sent',
          'not-sent',
          'not-sent',
        ]);
        expect(lab.events).toStrictEqual([]);
      });

      it('names the path the user typed for a file', async () => {
        const lab = uploadLab();
        server.use(...lab.handlers);

        await run({
          items: [{ file: fileOf(10, 'a.bin'), relativePath: 'docs/a.bin' }],
        });

        expect(lab.creates[0].fields['relative_path']).toBe('docs/a.bin');
      });
    });

    describe('the content create of each plugin', () => {
      const REPO =
        '/pulp/api/v3/repositories/x/y/00000000-0000-4000-8000-0000000000b1/';

      it.each([
        {
          plugin: 'file',
          entity: fileContent,
          path: '/pulp/api/v3/content/file/files/',
          // a path is needed: the file name unless one is typed
          plain: { relative_path: 'pkg.bin' },
          typed: { relative_path: 'docs/pkg.bin' },
        },
        {
          plugin: 'python',
          entity: pythonPackage,
          path: '/pulp/api/v3/content/python/packages/',
          // always the file name, whatever was typed
          plain: { relative_path: 'pkg.bin' },
          typed: { relative_path: 'pkg.bin' },
        },
        {
          plugin: 'deb',
          entity: debPackage,
          path: '/pulp/api/v3/content/deb/packages/',
          // a path only when one is given
          plain: {},
          typed: { relative_path: 'docs/pkg.bin' },
        },
        {
          plugin: 'rpm',
          entity: rpmPackage,
          path: '/pulp/api/v3/content/rpm/packages/',
          plain: {},
          typed: { relative_path: 'docs/pkg.bin' },
        },
      ])(
        'posts $plugin content to its own endpoint with the right path field',
        async ({ entity, path, plain, typed }) => {
          const lab = uploadLab({ contentPath: path });
          server.use(...lab.handlers);

          for (const [relativePath, expected] of [
            [undefined, plain],
            ['  ', plain],
            ['docs/pkg.bin', typed],
          ] as const) {
            lab.creates.length = 0;
            const task = await uploadFile({
              file: fileOf(10, 'pkg.bin'),
              contentEntity: entity,
              fields: entity.fieldsOf('pkg.bin', relativePath),
              repository: REPO,
              mayChunk: true,
            });

            expect(task).toMatch(/^\/pulp\/api\/v3\/tasks\//);
            expect(lab.creates).toStrictEqual([
              { fields: { ...expected, repository: REPO }, fileBytes: 10 },
            ]);
          }
        },
      );
    });
  },
);
