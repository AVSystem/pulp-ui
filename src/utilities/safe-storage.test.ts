import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockStorage } from 'src/test-utils/storage';
import { readStored, removeStored, writeStored } from './safe-storage';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('safe storage', () => {
  it('reads, writes and removes values like the storage itself', () => {
    expect(readStored('k')).toBeNull();
    writeStored('k', 'v');
    expect(window.localStorage.getItem('k')).toBe('v');
    expect(readStored('k')).toBe('v');
    removeStored('k');
    expect(window.localStorage.getItem('k')).toBeNull();
  });

  it('uses the session storage when asked', () => {
    writeStored('k', 'v', 'sessionStorage');
    expect(window.sessionStorage.getItem('k')).toBe('v');
    expect(window.localStorage.getItem('k')).toBeNull();
    removeStored('k', 'sessionStorage');
    expect(readStored('k', 'sessionStorage')).toBeNull();
  });

  it('treats a blocked storage as empty and ignores writes to it', () => {
    blockStorage();

    expect(readStored('k')).toBeNull();
    expect(() => writeStored('k', 'v')).not.toThrow();
    expect(() => removeStored('k')).not.toThrow();
    expect(() => removeStored('k', 'sessionStorage')).not.toThrow();
  });

  it('ignores a write that is refused, for example by a full storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    });

    expect(() => writeStored('k', 'v')).not.toThrow();
  });
});
