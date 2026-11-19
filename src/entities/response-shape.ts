import type { ZodType, output } from 'zod';

// The answer of a successful request does not have the shape a screen needs.
// It is a failure of this one read: the data may be fine on the next try, and
// nobody is refused anything, so it carries no HTTP response and is never read
// as a session end or as a permission problem.
//
// Only the path of the first mismatch is kept. The answer itself can hold
// names and values the user must not see in an error message or in a log, so
// no part of it is ever copied into the error.
export class ResponseShapeError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(
      path
        ? `The answer of the server does not have the expected shape at "${path}".`
        : 'The answer of the server does not have the expected shape.',
    );
    this.name = 'ResponseShapeError';
    this.path = path;
  }
}

// Checks an answer against the schema of the fields a screen reads, and
// returns what the schema produces. A mismatch throws a ResponseShapeError.
export function parseResponse<S extends ZodType>(
  schema: S,
  data: unknown,
): output<S> {
  const result = schema.safeParse(data);
  if (result.success) {
    return result.data;
  }

  const path = result.error.issues[0]?.path ?? [];
  throw new ResponseShapeError(path.map(String).join('.'));
}
