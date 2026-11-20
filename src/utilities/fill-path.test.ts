import { describe, expect, it } from 'vitest';
import { formatPath } from 'src/paths';
import { fillPath } from './fill-path';

describe('Unit: fillPath', { tags: ['unit'] }, () => {
  it('encodes each value into one path segment', () => {
    expect(fillPath('/a/:name', { name: 'x/y' })).toBe('/a/x%2Fy/');
    expect(fillPath('/a/:name', { name: '../z' })).toBe('/a/..%2Fz/');
    expect(fillPath('/a/:name/b/:n', { name: 'q r', n: 3 })).toBe(
      '/a/q%20r/b/3/',
    );
  });

  it('drops an optional parameter that has no value', () => {
    expect(fillPath('/a/:x?/:y', { y: 'v' })).toBe('/a/v/');
  });

  it('fails on a required parameter that has no value, and on an empty one', () => {
    expect(() => fillPath('/a/:x', {})).toThrow('missing url param x');
    expect(() => fillPath('/a/:x', { x: '' })).toThrow('missing url param x');
  });

  it('keeps a parameter without a value when asked to', () => {
    expect(fillPath('/a/:x/b', {}, { ignoreMissing: true })).toBe('/a/:x/b/');
  });

  it('fills the same address formatPath does', () => {
    for (const [path, data] of [
      ['/file/repositories/:name', { name: 'a b' }],
      ['/c/:namespace?/:container', { container: 'k' }],
      ['/tasks/:task', { task: 'abc' }],
    ] as const) {
      expect(fillPath(path, data)).toBe(formatPath(path, data));
    }
  });
});
