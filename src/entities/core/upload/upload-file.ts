import { runBounded } from 'src/entities/batch';
import type {
  ContentFields,
  UploadableContent,
} from 'src/entities/plugin/content';
import { UploadClient } from './client';
import type { ChunkRange } from './model';

const MIB = 1024 * 1024;

// How a file reaches the server, defined once. A file larger than
// `chunkAbove` goes through an upload in chunks of `chunkBytes`, with at most
// `chunksInFlight` chunks on their way at once, when the user may create
// uploads; every other file, and every file of a user who may not, is one
// request. At most `filesInFlight` files are sent at once.
export const UPLOAD_LIMITS = {
  chunkAbove: 8 * MIB,
  chunkBytes: 4 * MIB,
  chunksInFlight: 3,
  filesInFlight: 2,
} as const;

// How much of a file has been sent: bytes of the chunks the server has taken.
export interface UploadProgress {
  sent: number;
  total: number;
}

// The byte ranges a file of this size is cut into, in order. The last chunk
// holds what is left.
export function chunkRanges(
  size: number,
  chunkBytes: number = UPLOAD_LIMITS.chunkBytes,
): ChunkRange[] {
  const ranges: ChunkRange[] = [];

  for (let start = 0; start < size; start += chunkBytes) {
    ranges.push({ start, end: Math.min(start + chunkBytes, size) - 1 });
  }

  return ranges;
}

// Whether a file of this size is sent in chunks for a user who may or may not
// create uploads.
export function isChunked(size: number, mayChunk: boolean): boolean {
  return mayChunk && size > UPLOAD_LIMITS.chunkAbove;
}

function canceled(signal: AbortSignal): unknown {
  return (
    signal.reason ?? new DOMException('The upload was canceled.', 'AbortError')
  );
}

// Sends every chunk of the file to the upload. The first chunk that fails
// stops the others from starting and aborts the ones on their way; the
// function rejects with that failure once none is left in flight.
async function sendChunks(
  upload: string,
  file: Blob,
  signal: AbortSignal | undefined,
  onProgress: ((progress: UploadProgress) => void) | undefined,
): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const started: Promise<unknown>[] = [];
  let sent = 0;

  try {
    await runBounded(
      chunkRanges(file.size),
      UPLOAD_LIMITS.chunksInFlight,
      (range) => {
        const job = UploadClient.putChunk(
          upload,
          file.slice(range.start, range.end + 1),
          range,
          file.size,
          { signal: controller.signal },
        ).then(() => {
          sent += range.end - range.start + 1;
          onProgress?.({ sent, total: file.size });
        });
        started.push(job);
        return job;
      },
    );
  } catch (error) {
    controller.abort();
    // Nothing may still be writing to the upload when it is deleted.
    await Promise.allSettled(started);
    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
}

export interface UploadFileParams {
  file: Blob;
  contentEntity: UploadableContent<unknown>;
  // The fields that name the unit (its path), from the entity's `fieldsOf`.
  fields: ContentFields;
  // The repository the content is added to by the same task. Without one the
  // server only accepts the request from a superuser.
  repository?: string;
  // Whether the user may create uploads.
  mayChunk: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
}

// Sends one file and starts the task that makes its content, and answers the
// address of that task. A small file, or any file of a user who may not create
// uploads, is one multipart request. A larger file is cut into chunks that go
// to an upload, and the content is made from the finished upload. The upload
// is deleted when a chunk fails, when the caller cancels and when the content
// create is refused, so no half-finished upload keeps its storage. The
// function rejects with the failure of the request that went wrong.
export async function uploadFile({
  file,
  contentEntity,
  fields,
  repository,
  mayChunk,
  signal,
  onProgress,
}: UploadFileParams): Promise<string> {
  if (signal?.aborted) {
    throw canceled(signal);
  }
  const target = repository ? { repository } : {};

  if (!isChunked(file.size, mayChunk)) {
    return contentEntity.create({ ...fields, file, ...target }, { signal });
  }

  const upload = await UploadClient.create(file.size, { signal });
  try {
    await sendChunks(upload, file, signal, onProgress);
    return await contentEntity.create(
      { ...fields, upload, ...target },
      { signal },
    );
  } catch (error) {
    // Without the caller's signal: a canceled upload still has to be deleted.
    await UploadClient.remove(upload).catch(() => undefined);
    throw error;
  }
}
