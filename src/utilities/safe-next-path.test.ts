import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-next-path';

const FALLBACK = '/status';

describe('safeNextPath', () => {
  it('keeps a same-origin path with query', () => {
    expect(safeNextPath('/file/repositories/?page=2', FALLBACK)).toBe(
      '/file/repositories/?page=2',
    );
  });

  it('rejects a protocol-relative URL', () => {
    expect(safeNextPath('//evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a slash followed by a backslash', () => {
    expect(safeNextPath('/\\evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects an absolute URL', () => {
    expect(safeNextPath('https://evil.example', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects the login page', () => {
    expect(safeNextPath('/login', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects the login page with a trailing slash', () => {
    expect(safeNextPath('/login/', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects the login page with a query', () => {
    expect(safeNextPath('/login/?next=/x', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects an empty string', () => {
    expect(safeNextPath('', FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a missing value', () => {
    expect(safeNextPath(undefined, FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a repeated query parameter that parses to an array', () => {
    expect(safeNextPath(['/a', '/b'], FALLBACK)).toBe(FALLBACK);
  });

  it('rejects a control character', () => {
    expect(safeNextPath('/a\tb', FALLBACK)).toBe(FALLBACK);
  });
});
