// @vitest-environment node
// Tests of the route list the crawler builds from the application source.
import { describe, expect, it } from 'vitest';
import { crawlRoutes, fillPattern, parseRoutes, slugOf } from './routes.ts';

const PATHS = `
export const Paths = {
  core: { status: '/status', task: { detail: '/tasks/detail/:task' } },
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
      '/tasks/detail/:task',
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
