import { afterEach, describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({ config: null as unknown }));

vi.mock('src/ui-config', () => ({
  get config() {
    return holder.config;
  },
}));

import { clientEntryPoints, entryPointFor } from './entry-points';

const ORIGIN = 'https://pulp.example.org';

const configure = (entries: unknown) => {
  holder.config = { CLIENT_ENTRY_POINTS: entries };
};

afterEach(() => {
  holder.config = null;
});

describe('Unit: client entry points', { tags: ['unit'] }, () => {
  describe('clientEntryPoints', () => {
    it('is empty before the configuration is loaded', () => {
      holder.config = null;
      expect(clientEntryPoints()).toEqual([]);
    });

    it('is empty for a configuration without the key, with a key that is not a list and with an empty list', () => {
      holder.config = { API_BASE_PATH: '/pulp/api/v3/' };
      expect(clientEntryPoints()).toEqual([]);
      configure('https://example.com/');
      expect(clientEntryPoints()).toEqual([]);
      configure({ plugin: 'file', read: '/x/' });
      expect(clientEntryPoints()).toEqual([]);
      configure([]);
      expect(clientEntryPoints()).toEqual([]);
    });

    it('drops an entry that is not an object or lacks its plugin or its read address', () => {
      configure([
        null,
        'text',
        7,
        ['file'],
        { read: '/x/' },
        { plugin: 'file' },
        { plugin: '', read: '/x/' },
        { plugin: 'file', read: 4 },
        { plugin: 'file', basePaths: ['kept'], read: '/ok/' },
      ]);

      expect(clientEntryPoints()).toEqual([
        { plugin: 'file', basePaths: ['kept'], read: '/ok/' },
      ]);
    });

    it('keeps only the well typed optional fields of an entry', () => {
      configure([
        {
          plugin: 'deb',
          basePathPrefix: 'deb/',
          basePaths: 'not a list',
          read: 'https://example.com/{base_path}/',
          write: 5,
          signingKey: 'https://example.com/key.asc',
          suite: 'stable',
          components: ['main', 3, 'extra'],
        },
      ]);

      expect(clientEntryPoints()).toEqual([
        {
          plugin: 'deb',
          basePathPrefix: 'deb/',
          read: 'https://example.com/{base_path}/',
          signingKey: 'https://example.com/key.asc',
          suite: 'stable',
          components: ['main', 'extra'],
        },
      ]);
    });
  });

  describe('entryPointFor', () => {
    it('finds the entry that lists the base path for the plugin', () => {
      configure([
        {
          plugin: 'python',
          basePaths: ['pypi-local', 'pypi-cache'],
          read: '/repo/pypi/',
          write: '/repo/pypi/legacy/',
        },
      ]);

      expect(entryPointFor('python', 'pypi-local', ORIGIN)).toEqual({
        read: 'https://pulp.example.org/repo/pypi/',
        write: 'https://pulp.example.org/repo/pypi/legacy/',
        signingKey: null,
        suite: null,
        components: null,
      });
    });

    it('does not use an entry of another plugin or another base path', () => {
      configure([
        { plugin: 'python', basePaths: ['pypi-local'], read: '/repo/pypi/' },
      ]);

      expect(entryPointFor('npm', 'pypi-local', ORIGIN)).toBeNull();
      expect(entryPointFor('python', 'other', ORIGIN)).toBeNull();
    });

    it('matches a prefix and fills {base_path} in the address', () => {
      configure([
        {
          plugin: 'deb',
          basePathPrefix: 'deb/',
          read: 'https://packages.example.com/content/{base_path}/',
          signingKey: 'https://packages.example.com/key.asc',
          suite: 'stable',
          components: ['main'],
        },
      ]);

      expect(entryPointFor('deb', 'deb/cust-1', ORIGIN)).toEqual({
        read: 'https://packages.example.com/content/deb/cust-1/',
        write: null,
        signingKey: 'https://packages.example.com/key.asc',
        suite: 'stable',
        components: ['main'],
      });
      expect(entryPointFor('deb', 'other/cust-1', ORIGIN)).toBeNull();
    });

    it('encodes the base path it puts into an address, keeping its slashes', () => {
      configure([
        {
          plugin: 'rpm',
          basePathPrefix: 'rpm/',
          read: 'https://packages.example.com/{base_path}/',
        },
      ]);

      expect(entryPointFor('rpm', "rpm/a b'c<d>/$(x)", ORIGIN)?.read).toBe(
        "https://packages.example.com/rpm/a%20b'c%3Cd%3E/%24(x)/",
      );
    });

    it('resolves a relative address against the page origin', () => {
      configure([
        { plugin: 'file', basePaths: ['docs'], read: '/repo/docs/' },
        { plugin: 'file', basePaths: ['more'], read: 'repo/more/' },
      ]);

      expect(entryPointFor('file', 'docs', ORIGIN)?.read).toBe(
        'https://pulp.example.org/repo/docs/',
      );
      expect(entryPointFor('file', 'more', ORIGIN)?.read).toBe(
        'https://pulp.example.org/repo/more/',
      );
    });

    it('uses the first entry that matches', () => {
      configure([
        { plugin: 'file', basePaths: ['docs'], read: '/first/' },
        { plugin: 'file', basePaths: ['docs'], read: '/second/' },
      ]);

      expect(entryPointFor('file', 'docs', ORIGIN)?.read).toBe(
        'https://pulp.example.org/first/',
      );
    });

    it('matches nothing for an entry that names neither base paths nor a prefix', () => {
      configure([{ plugin: 'file', read: '/everything/' }]);

      expect(entryPointFor('file', 'docs', ORIGIN)).toBeNull();
    });

    it('ignores an entry whose address is not http or https', () => {
      configure([
        { plugin: 'file', basePaths: ['docs'], read: 'javascript:alert(1)' },
        { plugin: 'file', basePaths: ['docs'], read: 'ftp://example.com/' },
      ]);

      expect(entryPointFor('file', 'docs', ORIGIN)).toBeNull();
    });

    it('drops a write address or signing key that does not resolve, and keeps the entry', () => {
      configure([
        {
          plugin: 'python',
          basePaths: ['p'],
          read: '/repo/pypi/',
          write: 'javascript:alert(1)',
          signingKey: 'data:text/plain,x',
        },
      ]);

      const entry = entryPointFor('python', 'p', ORIGIN);
      expect(entry?.read).toBe('https://pulp.example.org/repo/pypi/');
      expect(entry?.write).toBeNull();
      expect(entry?.signingKey).toBeNull();
    });
  });
});
