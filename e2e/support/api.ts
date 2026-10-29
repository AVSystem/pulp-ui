import {
  type APIRequestContext,
  type APIResponse,
  request,
} from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account } from './accounts';
import { origin } from './env';

// Set-up and clean-up of the objects a remote test needs, through the REST API
// with the admin account of the run. Basic-authenticated calls carry no session
// and need no CSRF token.
//
// Every object a test writes is named zz-e2e-<run id>-<scope>-<suffix>. The run
// id is chosen once per run (and handed to the worker processes through the
// environment), the scope belongs to one spec file, so two runs and two files
// never touch each other's objects. Nothing else on the deployment is ever
// written: clean-up deletes only what the test registered plus whatever still
// carries the scope's own prefix.

export const API_BASE = '/pulp/api/v3/';

const RUN_ID_VARIABLE = 'PULP_UI_E2E_RUN_ID';

// A short random id of this run; every worker of the run sees the same one.
export function runId(): string {
  process.env[RUN_ID_VARIABLE] ??= randomBytes(3).toString('hex');
  return process.env[RUN_ID_VARIABLE];
}

export function apiContext(): Promise<APIRequestContext> {
  const { username, password } = account('admin');
  return request.newContext({
    baseURL: origin(),
    extraHTTPHeaders: {
      Authorization: basicAuthorization(username, password),
    },
  });
}

export interface PulpObject {
  pulp_href: string;
  name?: string;
  [field: string]: unknown;
}

interface Task {
  state: string;
  created_resources: string[];
  error?: { description?: string } | null;
}

// Endpoints that hold objects created by the tests, deepest dependants first.
const DISTRIBUTIONS = ['distributions/file/file/', 'distributions/deb/apt/'];
const REPOSITORIES = ['repositories/file/file/', 'repositories/deb/apt/'];

function url(pathOrHref: string): string {
  return pathOrHref.startsWith('/') ? pathOrHref : `${API_BASE}${pathOrHref}`;
}

async function fail(what: string, response: APIResponse): Promise<never> {
  const body = (await response.text()).slice(0, 300);
  throw new Error(`${what}: ${response.status()} ${body}`);
}

// The objects of one spec file on one deployment. Create them through this
// class, call cleanUp() in afterAll.
export class TestObjects {
  private readonly registered: string[] = [];

  private constructor(
    readonly api: APIRequestContext,
    readonly scope: string,
  ) {}

  static async open(scope: string): Promise<TestObjects> {
    return new TestObjects(await apiContext(), scope);
  }

  // zz-e2e-<run id>-<scope>-<suffix>
  name(suffix: string): string {
    return `${this.prefix}${suffix}`;
  }

  get prefix(): string {
    return `zz-e2e-${runId()}-${this.scope}-`;
  }

  // Every object of a list endpoint matching the filters, all pages.
  async list(path: string, params: Record<string, string> = {}) {
    const results: PulpObject[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await this.api.get(url(path), {
        params: { ...params, limit: '100', offset: String(offset) },
      });
      if (!response.ok()) {
        await fail(`GET ${path}`, response);
      }
      const page = (await response.json()) as {
        results: PulpObject[];
        next: string | null;
      };
      results.push(...page.results);
      if (!page.next) {
        return results;
      }
    }
  }

  async get(href: string): Promise<PulpObject> {
    const response = await this.api.get(url(href));
    if (!response.ok()) {
      await fail(`GET ${href}`, response);
    }
    return (await response.json()) as PulpObject;
  }

  // Waits for a task to finish and returns it; a failed or canceled task throws.
  async waitForTask(taskHref: string, timeoutMs = 120_000): Promise<Task> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = (await this.get(taskHref)) as unknown as Task;
      if (task.state === 'completed') {
        return task;
      }
      if (task.state === 'failed' || task.state === 'canceled') {
        throw new Error(
          `task ${taskHref} ${task.state}: ${task.error?.description ?? ''}`,
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          `task ${taskHref} still ${task.state} after ${timeoutMs} ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  // Creates an object, waits for the task when the server answers with one,
  // and registers the object for clean-up. A name that does not carry this
  // scope's prefix is refused, so a typo can never write a foreign object.
  async create(path: string, body: Record<string, unknown>) {
    if (
      typeof body['name'] === 'string' &&
      !body['name'].startsWith(this.prefix)
    ) {
      throw new Error(
        `refusing to create "${body['name']}": not under ${this.prefix}`,
      );
    }

    const response = await this.api.post(url(path), { data: body });
    if (!response.ok()) {
      await fail(`POST ${path}`, response);
    }
    const answer = (await response.json()) as PulpObject & { task?: string };
    if (response.status() === 201) {
      this.registered.push(answer.pulp_href);
      return answer;
    }

    const task = await this.waitForTask(answer.task as string);
    const href = task.created_resources[0] as string;
    this.registered.push(href);
    return this.get(href);
  }

  // Changes an object and waits for the task the server starts.
  async patch(href: string, body: Record<string, unknown>) {
    const response = await this.api.patch(url(href), { data: body });
    if (!response.ok()) {
      await fail(`PATCH ${href}`, response);
    }
    const answer = (await response.json()) as { task?: string };
    if (answer.task) {
      await this.waitForTask(answer.task);
    }
    return this.get(href);
  }

  // Deletes an object and waits for the task; an object that is already gone
  // is fine. A named object outside this scope is refused.
  async remove(href: string): Promise<void> {
    const current = await this.api.get(url(href));
    if (current.status() === 404) {
      return;
    }
    if (!current.ok()) {
      await fail(`GET ${href}`, current);
    }
    const { name } = (await current.json()) as PulpObject;
    if (typeof name === 'string' && !name.startsWith(this.prefix)) {
      throw new Error(`refusing to delete "${name}": not under ${this.prefix}`);
    }

    const response = await this.api.delete(url(href));
    if (response.status() === 404) {
      return;
    }
    if (!response.ok()) {
      await fail(`DELETE ${href}`, response);
    }
    if (response.status() === 202) {
      await this.waitForTask(
        ((await response.json()) as { task: string }).task,
      );
    }
  }

  // Registers an object that something else created, for example the UI.
  track(href: string): void {
    this.registered.push(href);
  }

  // Objects of this scope that still exist, by endpoint.
  async leftovers(): Promise<string[]> {
    const found: string[] = [];
    for (const path of [...DISTRIBUTIONS, ...REPOSITORIES]) {
      const objects = await this.list(path, {
        name__startswith: this.prefix,
        fields: 'pulp_href,name',
      });
      found.push(...objects.map((object) => `${path}${object.name}`));
    }
    return found;
  }

  // Deletes everything this scope created: registered objects in reverse order
  // of creation (distributions, then publications, then repositories), then
  // anything of the scope that is still listed, for objects created through
  // the UI. Throws when something is left; always closes the API context.
  async cleanUp(): Promise<void> {
    try {
      const rank = (href: string) =>
        href.includes('/distributions/')
          ? 0
          : href.includes('/publications/')
            ? 1
            : href.includes('/repositories/')
              ? 2
              : 3;
      const ordered = [...this.registered]
        .reverse()
        .sort((a, b) => rank(a) - rank(b));
      this.registered.length = 0;

      for (const group of [0, 1, 2, 3]) {
        await Promise.all(
          ordered
            .filter((href) => rank(href) === group)
            .map((href) => this.remove(href)),
        );
      }

      for (const endpoints of [DISTRIBUTIONS, REPOSITORIES]) {
        for (const path of endpoints) {
          const objects = await this.list(path, {
            name__startswith: this.prefix,
            fields: 'pulp_href,name',
          });
          await Promise.all(
            objects.map(({ pulp_href }) => this.remove(pulp_href)),
          );
        }
      }

      const left = await this.leftovers();
      if (left.length) {
        throw new Error(
          `objects left on the server after clean-up: ${left.join(', ')}`,
        );
      }
    } finally {
      await this.api.dispose();
    }
  }
}
