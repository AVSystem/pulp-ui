import { type APIRequestContext } from '@playwright/test';
import { API_BASE, apiContext } from '../support/api';
import {
  type CrawlRoute,
  PLACEHOLDER,
  UNKNOWN_PATH,
  fillPattern,
} from './routes';

// Turns a route with :parameters into a path the deployment can answer. Each
// parameter has a resolver that asks the API, as the admin account and with
// GET list calls only, for the first object of the matching list. A parameter
// whose list is empty, or that has no source on a plain Pulp, is filled with a
// placeholder and the screen is recorded as params: placeholder, so a page that
// then crashes on it is reported and not mistaken for a healthy one. A
// parameter that has no resolver at all fails the crawl, so a route with a new
// parameter can never be visited with a made-up value without anyone deciding
// so.

type First = (path: string) => Promise<Record<string, unknown> | null>;

interface Context {
  route: CrawlRoute;
  first: First;
}

type Resolver = (context: Context) => Promise<string | null>;

// The last path segment of an object's href is its id.
function idOf(href: unknown): string | null {
  return typeof href === 'string'
    ? (href.replace(/\/$/, '').split('/').pop() ?? null)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

// Repository and remote detail and edit pages are addressed by the object's
// name; the list to ask depends on the plugin the route belongs to.
const NAMED_LISTS: Record<string, string> = {
  '/deb/repositories': 'repositories/deb/apt/',
  '/deb/remotes': 'remotes/deb/apt/',
  '/file/repositories': 'repositories/file/file/',
  '/file/remotes': 'remotes/file/file/',
  '/ansible/repositories': 'repositories/ansible/ansible/',
  '/ansible/remotes': 'remotes/ansible/collection/',
};

function isCollectionRoute(route: CrawlRoute): boolean {
  return route.pattern.startsWith('/ansible/collections/');
}

// The collection screens need a namespace, a collection name and the
// distribution that serves them, which only an uploaded collection provides.
async function collection(
  { route, first }: Context,
  field: 'namespace' | 'name' | 'repo',
): Promise<string | null> {
  if (!isCollectionRoute(route)) {
    return null;
  }
  const version = await first('content/ansible/collection_versions/');
  if (!version) {
    return null;
  }
  if (field === 'repo') {
    const distribution = await first('distributions/ansible/ansible/');
    return text(distribution?.['base_path']);
  }
  return text(version[field]);
}

const RESOLVERS: Record<string, Resolver> = {
  task: async ({ first }) => idOf((await first('tasks/'))?.['pulp_href']),
  group: async ({ first }) => {
    const group = await first('groups/');
    return group?.['id'] === undefined ? null : String(group['id']);
  },
  role: async ({ first }) => idOf((await first('roles/'))?.['pulp_href']),
  user_id: async ({ first }) => {
    const user = await first('users/');
    return user?.['id'] === undefined ? null : String(user['id']);
  },
  name: async ({ route, first }) => {
    const list = NAMED_LISTS[route.pattern.split('/').slice(0, 3).join('/')];
    return list ? text((await first(list))?.['name']) : null;
  },
  namespace: (context) => collection(context, 'namespace'),
  collection: (context) => collection(context, 'name'),
  repo: (context) => collection(context, 'repo'),
  // No source on a plain Pulp: the container plugin keeps its own lists, which
  // the lab does not install, and the content documentation pages address a
  // page of a collection's own documentation.
  container: async () => null,
  digest: async () => null,
  type: async () => null,
  page: async () => null,
};

export interface ResolvedPath {
  // Relative to the UI root.
  path: string;
  params: 'resolved' | 'placeholder' | 'none';
}

export class ParamResolver {
  private api: APIRequestContext | undefined;
  private readonly answers = new Map<
    string,
    Promise<Record<string, unknown> | null>
  >();

  private readonly first: First = (path) => {
    let answer = this.answers.get(path);
    if (!answer) {
      answer = this.fetchFirst(path);
      this.answers.set(path, answer);
    }
    return answer;
  };

  private async fetchFirst(path: string) {
    this.api ??= await apiContext();
    const response = await this.api.get(`${API_BASE}${path}`, {
      params: { limit: '1' },
    });
    // A list the deployment does not have (a plugin that is not installed)
    // simply offers nothing to resolve from.
    if (response.status() === 404) {
      return null;
    }
    if (!response.ok()) {
      throw new Error(`GET ${path} answered ${response.status()}`);
    }
    const body = (await response.json()) as {
      results?: Record<string, unknown>[];
    };
    return body.results?.[0] ?? null;
  }

  async resolve(route: CrawlRoute): Promise<ResolvedPath> {
    if (route.pattern === '/') {
      return { path: '', params: 'none' };
    }
    if (route.pattern === '*') {
      return { path: UNKNOWN_PATH, params: 'none' };
    }

    const values: Record<string, string> = {};
    let placeholder = false;
    for (const name of route.params) {
      const resolver = RESOLVERS[name];
      if (!resolver) {
        throw new Error(
          `${route.pattern}: the parameter :${name} has no resolver in e2e/crawl/params.ts`,
        );
      }
      const value = await resolver({ route, first: this.first });
      if (value === null) {
        placeholder = true;
      }
      values[name] = value ?? PLACEHOLDER;
    }

    return {
      path: fillPattern(route.pattern, values),
      params: route.params.length
        ? placeholder
          ? 'placeholder'
          : 'resolved'
        : 'none',
    };
  }

  async close(): Promise<void> {
    await this.api?.dispose();
  }
}
