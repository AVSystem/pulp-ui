import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_MANIFESTS } from './manifest';
import {
  legacyPatternsOf,
  newRemotePath,
  newRepositoryPath,
  patternsOf,
  remoteEditPath,
  remoteListPath,
  remotePath,
  repositoryEditPath,
  repositoryListPath,
  repositoryPath,
  versionPath,
} from './route-patterns';

// The e2e specs and the crawler import the manifest and the route patterns, so
// these two modules must stay plain data and pure functions: one stray import
// of a component, the sdk or a macro would drag the application into the
// end-to-end runner and into the entry chunk of the build.

const SOURCE = (name: string) =>
  readFileSync(resolve(import.meta.dirname, name), 'utf8');

// The module of every import and re-export statement, with whether the
// statement is type-only.
function importsOf(source: string): { module: string; typeOnly: boolean }[] {
  return Array.from(
    source.matchAll(
      /^(?:import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s+)?['"]([^'"]+)['"]/gm,
    ),
  ).map((match) => ({
    module: match[2] as string,
    typeOnly: Boolean(match[1]),
  }));
}

describe('Unit: the manifest', { tags: ['unit'] }, () => {
  it('lists the plugins that have repository and remote screens in menu order', () => {
    expect(PLUGIN_MANIFESTS.map((manifest) => manifest.plugin)).toEqual([
      'file',
      'deb',
      'rpm',
      'python',
    ]);
    for (const manifest of PLUGIN_MANIFESTS) {
      expect(manifest.resources).toEqual(['repository', 'remote']);
      expect(manifest.label).not.toBe('');
    }
  });

  it('puts a plugin on the framework once it is switched over and keeps the others on their own screens', () => {
    expect(
      PLUGIN_MANIFESTS.map(({ plugin, onFramework }) => [plugin, onFramework]),
    ).toEqual([
      ['file', true],
      ['deb', true],
      ['rpm', false],
      ['python', false],
    ]);
  });

  it('names the permissions of each plugin with its own app label', () => {
    for (const manifest of PLUGIN_MANIFESTS) {
      const names = [
        ...Object.values(manifest.permissions.repository),
        ...Object.values(manifest.permissions.remote),
      ];
      for (const name of names) {
        expect(name.startsWith(`${manifest.plugin}.`)).toBe(true);
      }
    }
  });

  it('imports nothing but types', () => {
    const imports = importsOf(SOURCE('manifest.ts'));

    expect(imports.filter(({ typeOnly }) => !typeOnly)).toEqual([]);
  });
});

describe('Unit: the route patterns module', { tags: ['unit'] }, () => {
  it('imports only types and the path filler', () => {
    const runtime = importsOf(SOURCE('route-patterns.ts'))
      .filter(({ typeOnly }) => !typeOnly)
      .map(({ module }) => module);

    expect(runtime).toEqual(['../utilities/fill-path']);
  });
});

describe(
  'Unit: addresses of repositories and remotes',
  { tags: ['unit'] },
  () => {
    it('builds the list, detail, tab, version, edit and create addresses', () => {
      expect(repositoryListPath('file')).toBe('/file/repositories/');
      expect(repositoryPath('file', 'repo-1')).toBe(
        '/file/repositories/repo-1/',
      );
      expect(repositoryPath('deb', 'repo-1', 'distributions')).toBe(
        '/deb/repositories/repo-1/distributions/',
      );
      expect(versionPath('rpm', 'repo-1', 3)).toBe(
        '/rpm/repositories/repo-1/versions/3/',
      );
      expect(repositoryEditPath('python', 'repo-1')).toBe(
        '/python/repositories/repo-1/edit/',
      );
      expect(newRepositoryPath('file')).toBe('/file/repository/new/');
      expect(remoteListPath('file')).toBe('/file/remotes/');
      expect(remotePath('file', 'remote-1')).toBe('/file/remotes/remote-1/');
      expect(remoteEditPath('file', 'remote-1')).toBe(
        '/file/remotes/remote-1/edit/',
      );
      expect(newRemotePath('file')).toBe('/file/remote/new/');
    });

    it('addresses version 0, which is a version like any other', () => {
      expect(versionPath('file', 'repo-1', 0)).toBe(
        '/file/repositories/repo-1/versions/0/',
      );
    });

    it('encodes a name into one path segment', () => {
      expect(repositoryPath('file', 'a/b')).toBe('/file/repositories/a%2Fb/');
      expect(repositoryPath('file', 'a b?c#d')).toBe(
        '/file/repositories/a%20b%3Fc%23d/',
      );
      expect(remotePath('file', '../x')).toBe('/file/remotes/..%2Fx/');
    });

    it('puts create outside the name namespace so no repository name is shadowed', () => {
      const patterns = patternsOf('file').map(({ pattern }) => pattern);

      expect(patterns).toContain('/file/repository/new');
      expect(patterns).not.toContain('/file/repositories/new');
      expect(patterns).not.toContain('/file/repositories/:name/new');
    });
  },
);

describe('Unit: the pattern set of a plugin', { tags: ['unit'] }, () => {
  it('holds every address of the table once', () => {
    const patterns = patternsOf('file');

    expect(patterns.map(({ pattern }) => pattern)).toEqual([
      '/file/repositories',
      '/file/repositories/:name',
      '/file/repositories/:name/versions',
      '/file/repositories/:name/versions/:number',
      '/file/repositories/:name/distributions',
      '/file/repositories/:name/packages',
      '/file/repositories/:name/edit',
      '/file/repository/new',
      '/file/remotes',
      '/file/remotes/:name',
      '/file/remotes/:name/edit',
      '/file/remote/new',
    ]);
    expect(new Set(patterns.map(({ pattern }) => pattern)).size).toBe(
      patterns.length,
    );
  });

  it('names the screen each pattern leads to', () => {
    expect(
      Object.fromEntries(
        patternsOf('deb').map(({ pattern, screen }) => [pattern, screen]),
      ),
    ).toMatchObject({
      '/deb/repositories': 'repository-list',
      '/deb/repositories/:name': 'repository-detail',
      '/deb/repositories/:name/versions': 'repository-tab',
      '/deb/repositories/:name/versions/:number': 'repository-tab',
      '/deb/repositories/:name/edit': 'repository-edit',
      '/deb/repository/new': 'repository-create',
      '/deb/remotes': 'remote-list',
      '/deb/remotes/:name': 'remote-detail',
      '/deb/remotes/:name/edit': 'remote-edit',
      '/deb/remote/new': 'remote-create',
    });
  });

  it('names the tab each tab pattern shows', () => {
    const tabs = patternsOf('file')
      .filter(({ screen }) => screen === 'repository-tab')
      .map(({ pattern, tab }) => [pattern, tab]);

    expect(tabs).toEqual([
      ['/file/repositories/:name/versions', 'versions'],
      ['/file/repositories/:name/versions/:number', 'versions'],
      ['/file/repositories/:name/distributions', 'distributions'],
      ['/file/repositories/:name/packages', 'packages'],
    ]);
  });

  it('lists the old addresses that move to the new ones', () => {
    expect(legacyPatternsOf('python').map(({ pattern }) => pattern)).toEqual([
      '/python/repositories/detail/:name',
      '/python/repositories/edit/:name',
      '/python/repositories/edit/_',
      '/python/remotes/detail/:name',
      '/python/remotes/edit/:name',
      '/python/remotes/edit/_',
    ]);
  });
});
