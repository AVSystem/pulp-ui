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

  it.each([
    ['..', '/a/%252E%252E/'],
    ['.', '/a/%252E/'],
  ])('never lets the value %j resolve as a dot segment', (name, expected) => {
    expect(fillPath('/a/:name', { name })).toBe(expected);
    // the address the browser resolves keeps the segment in place
    expect(new URL(fillPath('/a/:name', { name }), 'https://h').pathname).toBe(
      expected,
    );
  });

  it('keeps a dot that is part of a longer value', () => {
    expect(fillPath('/a/:name', { name: 'v1.0' })).toBe('/a/v1.0/');
    expect(fillPath('/a/:name', { name: '.hidden' })).toBe('/a/.hidden/');
    expect(fillPath('/a/:name', { name: 'a..' })).toBe('/a/a../');
    expect(fillPath('/a/:name', { name: '...' })).toBe('/a/.../');
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
