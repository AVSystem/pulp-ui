import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GenericPulpAPI } from '../api/generic-pulp';
import { ObjectPermissions, loadMyPermissions } from './my-permissions';

vi.mock('../api/generic-pulp', () => ({
  GenericPulpAPI: { get: vi.fn() },
}));

const get = vi.mocked(GenericPulpAPI.get);

const HREF =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-0000000000a1/';
const OTHER =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-0000000000a2/';
const PAUSE = 30_000;

const answer = (permissions: unknown) =>
  get.mockResolvedValueOnce({ data: { permissions } } as never);
const fail = () => get.mockRejectedValueOnce(new Error('unavailable'));
// lets the answer of a read reach the cache
const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  get.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadMyPermissions', () => {
  it('reads the permissions of the object the address names', async () => {
    answer([]);

    await loadMyPermissions(HREF);
    await loadMyPermissions(HREF.replace(/\/$/, ''));

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      `repositories/file/file/00000000-0000-4000-8000-0000000000a1/my_permissions/`,
      `repositories/file/file/00000000-0000-4000-8000-0000000000a1/my_permissions/`,
    ]);
  });

  it.each([
    'https://evil.example/pulp/api/v3/repositories/file/file/x/',
    '//evil.example/pulp/api/v3/repositories/file/file/x/',
    '/other/api/v3/repositories/file/file/x/',
    '/pulp/api/v3/repositories/%2e%2e/%2e%2e/users/',
    '/pulp/api/v3/repositories/file/file/x/?next=1',
    'repositories/file/file/x/',
    '',
  ])('asks nothing and answers unknown for the address %j', async (href) => {
    await expect(loadMyPermissions(href)).resolves.toBeNull();

    expect(get).not.toHaveBeenCalled();
  });

  it('answers the permissions the server lists', async () => {
    answer(['file.change_filerepository']);

    await expect(loadMyPermissions(HREF)).resolves.toEqual([
      'file.change_filerepository',
    ]);
    expect(get).toHaveBeenCalledWith(
      expect.stringMatching(
        /repositories\/file\/file\/[^/]+\/my_permissions\/$/,
      ),
    );
  });

  it('keeps an empty list an empty list', async () => {
    answer([]);

    await expect(loadMyPermissions(HREF)).resolves.toEqual([]);
  });

  it('answers null when the read fails', async () => {
    fail();

    await expect(loadMyPermissions(HREF)).resolves.toBeNull();
  });

  it('answers null when the answer carries no list', async () => {
    answer(undefined);

    await expect(loadMyPermissions(HREF)).resolves.toBeNull();
  });
});

describe('ObjectPermissions after a failed read', () => {
  const object = { pulp_href: HREF };
  const held = () => false;

  it('holds nothing, does not know the object and tells the screen', async () => {
    fail();
    const changed = vi.fn();
    const cache = new ObjectPermissions(changed);

    cache.read(HREF);
    expect(cache.failed(object)).toBe(false);
    await settle();

    expect(changed).toHaveBeenCalledTimes(1);
    expect(cache.failed(object)).toBe(true);
    expect(cache.knows(object)).toBe(false);
    expect(cache.holds('file.change_filerepository', object, held)).toBe(false);
  });

  it('sends nothing within the pause, and asks again after it', async () => {
    fail();
    answer(['file.change_filerepository']);
    const changed = vi.fn();
    const cache = new ObjectPermissions(changed);

    cache.read(HREF);
    await settle();
    expect(get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(PAUSE - 1);
    cache.read(HREF);
    await settle();
    expect(get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    cache.read(HREF);
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.knows(object)).toBe(true);
    expect(cache.failed(object)).toBe(false);
    expect(cache.holds('file.change_filerepository', object, held)).toBe(true);
  });

  it('waits the pause again after a second failure', async () => {
    fail();
    fail();
    const cache = new ObjectPermissions(vi.fn());

    cache.read(HREF);
    await settle();
    await vi.advanceTimersByTimeAsync(PAUSE);
    cache.read(HREF);
    await settle();
    expect(get).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(PAUSE - 1);
    cache.read(HREF);
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps the pause of one object from holding back another', async () => {
    fail();
    answer([]);
    const cache = new ObjectPermissions(vi.fn());

    cache.read(HREF);
    await settle();
    cache.read(OTHER);
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.knows({ pulp_href: OTHER })).toBe(true);
  });

  it('asks at once after a reset', async () => {
    fail();
    answer(['file.sync_filerepository']);
    const cache = new ObjectPermissions(vi.fn());

    cache.read(HREF);
    await settle();
    cache.reset();
    cache.read(HREF);
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.holds('file.sync_filerepository', object, held)).toBe(true);
  });
});

describe('ObjectPermissions after an answer', () => {
  const object = { pulp_href: HREF };

  it('remembers an empty list and never asks for the object again', async () => {
    answer([]);
    const cache = new ObjectPermissions(vi.fn());

    cache.read(HREF);
    await settle();
    await vi.advanceTimersByTimeAsync(PAUSE * 4);
    cache.read(HREF);
    await settle();

    expect(get).toHaveBeenCalledTimes(1);
    expect(cache.knows(object)).toBe(true);
  });

  it('drops an answer that arrives after a reset', async () => {
    const changed = vi.fn();
    let release: (value: never) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const cache = new ObjectPermissions(changed);

    cache.read(HREF);
    cache.reset();
    changed.mockClear();
    release({ data: { permissions: ['file.delete_filerepository'] } } as never);
    await settle();

    expect(cache.knows(object)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it('drops a failure that arrives after a reset, so the next read asks at once', async () => {
    let fails: (reason: Error) => void = () => undefined;
    get.mockReturnValueOnce(new Promise((_, reject) => (fails = reject)));
    answer([]);
    const cache = new ObjectPermissions(vi.fn());

    cache.read(HREF);
    cache.reset();
    fails(new Error('unavailable'));
    await settle();
    cache.read(HREF);
    await settle();

    expect(get).toHaveBeenCalledTimes(2);
    expect(cache.knows(object)).toBe(true);
  });
});
