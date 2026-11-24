import { z } from 'zod';
import { apiPathOfHref, pulpHrefSchema } from 'src/entities/href';

// What the server answers when an upload is created: the address of the
// upload, which every chunk and the deletion are sent to. The address is
// checked before it is used, because it is appended to requests: it must name
// an upload below the API and nothing else.
const UPLOAD_PATH = /^uploads\/[^/]+\/$/;

export const uploadSchema = z.looseObject({
  pulp_href: pulpHrefSchema.refine(
    (value) => UPLOAD_PATH.test(apiPathOfHref(value) ?? ''),
    { error: 'pulp_href must name an upload' },
  ),
});

// Which bytes of the file a chunk holds. `end` is the last byte, as in the
// Content-Range header, not the byte after it.
export interface ChunkRange {
  start: number;
  end: number;
}

// The value of the Content-Range header of a chunk of a file of this size.
export function contentRangeOf({ start, end }: ChunkRange, size: number) {
  return `bytes ${start}-${end}/${size}`;
}
