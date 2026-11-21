// @vitest-environment node
// Tests of the route list the crawler builds from the application source.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_MANIFESTS } from '../../src/framework/manifest.ts';
import { crawlRoutes, fillPattern, parseRoutes, slugOf } from './routes.ts';

const PATHS = `
export const Paths = {
  core: { status: '/status', task: { detail: '/tasks/:task' } },
  meta: { login: '/login' },
  container: { detail: '/container/containers/detail/:namespace?/:container' },
};
`;

const routesModule = (entries) => `
const routes: IRouteConfig[] = [
${entries}
];
`;

describe('parseRoutes', () => {
  it('reads paths and noAuth, and adds the index and the catch-all', () => {
    const routes = parseRoutes(
      routesModule(`
  { component: A, path: Paths.core.status, noAuth: true },
  { component: B, path: Paths.core.task.detail, beta: true },
`),
      PATHS,
    );
    expect(routes.map((r) => r.pattern)).toEqual([
      '/status',
      '/tasks/:task',
      '/',
      '*',
    ]);
    expect(routes[0].noAuth).toBe(true);
    expect(routes[1].noAuth).toBe(false);
    expect(routes[1].params).toEqual(['task']);
  });

  it('fails on an entry whose path is not a Paths reference', () => {
    expect(() =>
      parseRoutes(routesModule(`  { component: A, path: '/literal' },`), PATHS),
    ).toThrow(/cannot be crawled/);
  });

  it('fails on an entry without a path', () => {
    expect(() =>
      parseRoutes(routesModule('  { component: A },'), PATHS),
    ).toThrow(/cannot be crawled/);
  });

  it('fails on a Paths reference that does not exist', () => {
    expect(() =>
      parseRoutes(
        routesModule('  { component: A, path: Paths.core.nope },'),
        PATHS,
      ),
    ).toThrow(/not a path string/);
  });

  it('fails when two routes would share a report name', () => {
    expect(() =>
      parseRoutes(
        routesModule(`
  { component: A, path: Paths.core.status },
  { component: B, path: Paths.core.status },
`),
        PATHS,
      ),
    ).toThrow(/share the report name/);
  });
});

describe('slugOf', () => {
  it('derives distinct names for an optional and a required parameter', () => {
    expect(slugOf('/c/:namespace?/:container')).not.toBe(
      slugOf('/c/:namespace/:container'),
    );
  });
});

describe('fillPattern', () => {
  it('fills parameters and drops an optional one without a value', () => {
    expect(fillPattern('/a/:x?/:y', { y: 'v w' })).toBe('a/v%20w');
    expect(fillPattern('/a/:x?/:y', { x: '1', y: '2' })).toBe('a/1/2');
  });

  it('fails on a required parameter without a value', () => {
    expect(() => fillPattern('/a/:x', {})).toThrow(/no value/);
  });
});

describe('the application', () => {
  it('has routes that all parse, with unique report names', () => {
    const routes = crawlRoutes();
    expect(routes.length).toBeGreaterThan(40);
    expect(new Set(routes.map((r) => r.slug)).size).toBe(routes.length);
  });
});

// The addresses of the plugins whose screens come from a descriptor are plain
// data in the framework, read as a second source next to the text of the
// application's routes.
const fileOnFramework = PLUGIN_MANIFESTS.map((manifest) =>
  manifest.plugin === 'file' ? { ...manifest, onFramework: true } : manifest,
);

describe('the framework route source', () => {
  it('adds nothing while no plugin is on the framework', () => {
    const fromText = parseRoutes(
      readFileSync(resolve('src', 'app-routes.tsx'), 'utf8'),
      readFileSync(resolve('src', 'paths.ts'), 'utf8'),
    );
    const none = PLUGIN_MANIFESTS.map((manifest) => ({
      ...manifest,
      onFramework: false,
    }));

    expect(crawlRoutes(none).map((r) => r.pattern)).toEqual(
      fromText.map((r) => r.pattern),
    );
  });

  it('visits the screens of the plugins the application serves from the framework', () => {
    const patterns = crawlRoutes().map((r) => r.pattern);

    for (const pattern of [
      '/file/repositories',
      '/file/repositories/:name',
      '/file/repositories/:name/versions/:number',
      '/file/repository/new',
      '/file/remotes',
      '/file/remotes/:name/edit',
      '/file/remote/new',
      '/deb/repositories',
      '/deb/repositories/:name/distributions',
      '/deb/remotes/:name/edit',
      '/deb/remote/new',
      '/rpm/repositories',
      '/rpm/repositories/:name/packages',
      '/rpm/remotes/:name/edit',
      '/rpm/remote/new',
      '/python/repositories',
      '/python/repositories/:name/packages',
      '/python/remotes/:name/edit',
      '/python/remote/new',
    ]) {
      expect(patterns, pattern).toContain(pattern);
    }
    // the old addresses are redirects, not screens to crawl
    expect(patterns).not.toContain('/file/repositories/detail/:name');
    expect(patterns).not.toContain('/file/remotes/edit/:name');
    expect(patterns).not.toContain('/deb/repositories/detail/:name');
    expect(patterns).not.toContain('/deb/remotes/edit/:name');
    expect(patterns).not.toContain('/rpm/repositories/detail/:name');
    expect(patterns).not.toContain('/rpm/remotes/edit/:name');
    expect(patterns).not.toContain('/python/repositories/detail/:name');
    expect(patterns).not.toContain('/python/remotes/edit/:name');
    // the plugins that are not on the framework are still read from the routes
    expect(patterns).toContain('/ansible/repositories/detail/:name');
  });

  it('lists every address of a plugin that is on the framework, each once, with unique report names', () => {
    const routes = crawlRoutes(fileOnFramework);
    const patterns = routes.map((r) => r.pattern);

    for (const pattern of [
      '/file/repositories/:name',
      '/file/repositories/:name/versions',
      '/file/repositories/:name/versions/:number',
      '/file/repositories/:name/distributions',
      '/file/repositories/:name/packages',
      '/file/repositories/:name/edit',
      '/file/repository/new',
      '/file/remotes/:name',
      '/file/remotes/:name/edit',
      '/file/remote/new',
    ]) {
      expect(
        patterns.filter((p) => p === pattern),
        pattern,
      ).toHaveLength(1);
    }
    // the list address is in the application's own routes already
    expect(patterns.filter((p) => p === '/file/repositories')).toHaveLength(1);
    expect(patterns.filter((p) => p === '/file/remotes')).toHaveLength(1);
    expect(new Set(routes.map((r) => r.slug)).size).toBe(routes.length);
  });

  it('names the parameters of the new addresses', () => {
    const byPattern = Object.fromEntries(
      crawlRoutes(fileOnFramework).map((r) => [r.pattern, r]),
    );

    expect(byPattern['/file/repositories/:name'].params).toEqual(['name']);
    expect(
      byPattern['/file/repositories/:name/versions/:number'].params,
    ).toEqual(['name', 'number']);
    expect(byPattern['/file/repository/new'].params).toEqual([]);
    expect(byPattern['/file/repositories/:name'].noAuth).toBe(false);
  });

  it('keeps the other plugins as they are', () => {
    const patterns = crawlRoutes(fileOnFramework).map((r) => r.pattern);

    expect(patterns).not.toContain('/ansible/repositories/:name');
    expect(patterns).toContain('/ansible/repositories/detail/:name');
  });

  it('still stops on an entry of the application routes that cannot be read', () => {
    expect(() =>
      parseRoutes(
        routesModule("  { component: A, path: '/literal' },"),
        PATHS,
        ['/file/repositories/:name'],
      ),
    ).toThrow(/cannot be crawled/);
  });

  it('adds the addresses after the routes and before the index and the catch-all', () => {
    const routes = parseRoutes(
      routesModule('  { component: A, path: Paths.core.status },'),
      PATHS,
      ['/file/repositories/:name', '/file/repositories/:name/edit'],
    );

    expect(routes.map((r) => r.pattern)).toEqual([
      '/status',
      '/file/repositories/:name',
      '/file/repositories/:name/edit',
      '/',
      '*',
    ]);
  });

  it('lists an address once when the application already has it', () => {
    const routes = parseRoutes(
      routesModule('  { component: A, path: Paths.core.status },'),
      PATHS,
      ['/status', '/file/repositories/:name'],
    );

    expect(routes.map((r) => r.pattern)).toEqual([
      '/status',
      '/file/repositories/:name',
      '/',
      '*',
    ]);
  });
});
