import { describe, expect, it } from 'vitest';
import { fileContent } from 'src/entities/file/content';
import { uploadLab } from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import { UPLOAD_LIMITS, uploadFile } from './upload-file';

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
