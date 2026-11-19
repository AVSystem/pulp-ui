import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isSessionEnd, requestErrorStatus } from 'src/utilities/request-error';
import { ResponseShapeError, parseResponse } from './response-shape';

describe('Unit: parseResponse', { tags: ['unit'] }, () => {
  const schema = z.looseObject({
    count: z.number(),
    results: z.array(z.looseObject({ name: z.string() })),
  });

  it('returns the data of an answer that has the expected shape', () => {
    const data = { count: 1, results: [{ name: 'a' }] };

    expect(parseResponse(schema, data)).toStrictEqual(data);
  });

  it('keeps a field the schema does not name', () => {
    const data = { count: 0, results: [], later_field: 'x' };

    expect(parseResponse(schema, data)).toStrictEqual(data);
  });

  it('throws a ResponseShapeError that names the path of the first mismatch', () => {
    const data = { count: 2, results: [{ name: 'a' }, { name: 7 }] };

    let thrown: unknown;
    try {
      parseResponse(schema, data);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ResponseShapeError);
    expect((thrown as ResponseShapeError).path).toBe('results.1.name');
    expect((thrown as ResponseShapeError).message).toContain('results.1.name');
  });

  it('names the whole answer when it is not an object at all', () => {
    expect(() => parseResponse(schema, 'oops')).toThrow(ResponseShapeError);
    expect(() => parseResponse(schema, null)).toThrow(/answer/);
  });

  it('never puts a value of the answer into the message', () => {
    const data = { count: 'a-secret-value', results: [] };

    let thrown: Error | undefined;
    try {
      parseResponse(schema, data);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).not.toContain('a-secret-value');
    expect(JSON.stringify(thrown)).not.toContain('a-secret-value');
  });

  it('is neither an HTTP failure nor the end of a session', () => {
    const error = new ResponseShapeError('count');

    expect(requestErrorStatus(error)).toBeNull();
    expect(isSessionEnd(error)).toBe(false);
  });
});
