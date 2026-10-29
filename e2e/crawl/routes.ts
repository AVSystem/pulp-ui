import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';

// The screens the crawler visits: every route of the application plus the
// index and one path no route matches. The routes are read from the source of
// src/app-routes.tsx as text, because importing that module would load every
// container of the application into the test runner, and each route is
// resolved against the Paths object of src/paths.ts, whose literal is read the
// same way so the end-to-end code does not compile the application. An entry
// that cannot be read stops the crawl, so a route added to the application can
// never be skipped without anyone noticing.

export interface CrawlRoute {
  // The route as declared, with :parameters (for example /deb/remotes/detail/:name).
  // The index is '/' and the catch-all is '*'.
  pattern: string;
  // A file-name-safe name derived from the pattern, unique among all routes.
  slug: string;
  // The route is reachable without a session.
  noAuth: boolean;
  // Names of the parameters in the pattern, optional ones included.
  params: string[];
}

// What a parameter is replaced with when the server has no object to name.
export const PLACEHOLDER = 'zz-crawl-placeholder';

// The path the catch-all route is asked for.
export const UNKNOWN_PATH = 'zz-crawl-no-such-page';

const ROUTES_DECLARATION = /const routes\s*:[^=]*=\s*\[/;

// The text between the brackets of the routes array.
function routesBlock(source: string): string {
  const start = ROUTES_DECLARATION.exec(source);
  if (!start) {
    throw new Error(
      'src/app-routes.tsx: the "const routes = [" declaration was not found',
    );
  }

  let depth = 1;
  for (let i = start.index + start[0].length; i < source.length; i++) {
    const character = source[i];
    if (character === '[') {
      depth++;
    } else if (character === ']') {
      depth--;
      if (depth === 0) {
        return source.slice(start.index + start[0].length, i);
      }
    }
  }
  throw new Error('src/app-routes.tsx: the routes array is never closed');
}

// The top-level { ... } entries of the array text.
function entries(block: string): string[] {
  const found: string[] = [];
  let depth = 0;
  let begin = -1;
  for (let i = 0; i < block.length; i++) {
    const character = block[i];
    if (character === '{') {
      if (depth === 0) {
        begin = i;
      }
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0) {
        found.push(block.slice(begin, i + 1));
      }
    }
  }
  return found;
}

// The value of the exported Paths object literal of src/paths.ts. The literal
// holds only strings and nested objects; anything else fails to evaluate.
function readPaths(source: string): Record<string, unknown> {
  const start = /export const Paths\s*=\s*\{/.exec(source);
  if (!start) {
    throw new Error('src/paths.ts: "export const Paths = {" was not found');
  }
  let depth = 0;
  for (let i = start.index + start[0].length - 1; i < source.length; i++) {
    if (source[i] === '{') {
      depth++;
    } else if (source[i] === '}') {
      depth--;
      if (depth === 0) {
        const literal = source.slice(start.index + start[0].length - 1, i + 1);
        return runInNewContext(`(${literal})`, Object.create(null)) as Record<
          string,
          unknown
        >;
      }
    }
  }
  throw new Error('src/paths.ts: the Paths object is never closed');
}

function lookup(paths: Record<string, unknown>, dotted: string): string {
  let node: unknown = paths;
  for (const key of dotted.split('.')) {
    node = (node as Record<string, unknown> | undefined)?.[key];
  }
  if (typeof node !== 'string') {
    throw new Error(`Paths.${dotted} is not a path string`);
  }
  return node;
}

export function slugOf(pattern: string): string {
  if (pattern === '/') {
    return 'root';
  }
  if (pattern === '*') {
    return 'unknown';
  }
  return pattern
    .replace(/^\//, '')
    .split('/')
    .map((segment) => {
      const parameter = segment.match(/^:(\w+)(\?)?$/);
      return parameter
        ? `by-${parameter[1]}${parameter[2] ? '-opt' : ''}`
        : segment;
    })
    .join('-')
    .replace(/[^A-Za-z0-9_-]/g, '_');
}

export function paramsOf(pattern: string): string[] {
  return [...pattern.matchAll(/\/:(\w+)\??(?=\/|$)/g)].map(
    (match) => match[1] as string,
  );
}

// Parses the text of the routes module. Exported for the tests of the parser.
export function parseRoutes(source: string, pathsSource: string): CrawlRoute[] {
  const paths = readPaths(pathsSource);
  const routes: CrawlRoute[] = [];

  for (const entry of entries(routesBlock(source))) {
    const declared = [...entry.matchAll(/\bpath\s*:/g)];
    const path = entry.match(/\bpath\s*:\s*Paths\.([\w.]+)\s*(?:,|\}|$)/m);
    if (declared.length !== 1 || !path) {
      throw new Error(
        'src/app-routes.tsx: a route entry has no path of the form ' +
          `"path: Paths.<group>.<name>", so it cannot be crawled:\n${entry}`,
      );
    }

    const pattern = lookup(paths, path[1] as string);
    routes.push({
      pattern,
      slug: slugOf(pattern),
      noAuth: /\bnoAuth\s*:\s*true\b/.test(entry),
      params: paramsOf(pattern),
    });
  }

  if (routes.length === 0) {
    throw new Error('src/app-routes.tsx: no route entries were found');
  }

  routes.push(
    { pattern: '/', slug: slugOf('/'), noAuth: false, params: [] },
    { pattern: '*', slug: slugOf('*'), noAuth: false, params: [] },
  );

  const owner = new Map<string, string>();
  for (const route of routes) {
    const other = owner.get(route.slug);
    if (other !== undefined) {
      throw new Error(
        `routes ${other} and ${route.pattern} share the report name ${route.slug}`,
      );
    }
    owner.set(route.slug, route.pattern);
  }
  return routes;
}

export function crawlRoutes(): CrawlRoute[] {
  return parseRoutes(
    readFileSync(resolve('src', 'app-routes.tsx'), 'utf8'),
    readFileSync(resolve('src', 'paths.ts'), 'utf8'),
  );
}

// The path of a pattern relative to the UI root with each :parameter replaced
// by its value; an optional parameter without a value drops out.
export function fillPattern(
  pattern: string,
  values: Record<string, string>,
): string {
  return pattern
    .split('/')
    .map((segment) => {
      const parameter = segment.match(/^:(\w+)(\?)?$/);
      if (!parameter) {
        return segment;
      }
      const value = values[parameter[1] as string];
      if (value === undefined) {
        if (parameter[2]) {
          return '';
        }
        throw new Error(`no value for :${parameter[1]} in ${pattern}`);
      }
      return encodeURIComponent(value);
    })
    .join('/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\//, '');
}
