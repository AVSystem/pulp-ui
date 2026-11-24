import {
  uploadsCreate,
  uploadsDelete,
  uploadsUpdate,
} from '@pulp-ui/sdk/core/uploads';
import { parseResponse } from 'src/entities/response-shape';
import { type ChunkRange, contentRangeOf, uploadSchema } from './model';

// The uploads of the server: a file that is too large for one request is
// sent in chunks to an upload, and the content is made from the finished
// upload. The bytes are never hashed here; the server does that when it
// makes the content.

// Starts an upload for a file of this many bytes and answers its address.
async function create(size: number, options?: RequestInit): Promise<string> {
  const data = await uploadsCreate({ size }, options);
  return parseResponse(uploadSchema, data).pulp_href;
}

// Sends one chunk of an upload. The chunk says which bytes of the whole file
// it holds, so the server can take the chunks in any order.
async function putChunk(
  upload: string,
  chunk: Blob,
  range: ChunkRange,
  size: number,
  options?: Pick<RequestInit, 'signal'>,
): Promise<void> {
  await uploadsUpdate(
    upload,
    { file: chunk },
    { ...options, headers: { 'Content-Range': contentRangeOf(range, size) } },
  );
}

// Deletes an upload and the chunks it holds.
async function remove(upload: string, options?: RequestInit): Promise<void> {
  await uploadsDelete(upload, options);
}

export const UploadClient = { create, putChunk, remove };
