import { type APIRequestContext, request } from '@playwright/test';
import { getRepositoriesAnsibleAnsibleListUrl } from '@pulp-ui/sdk/ansible/repositories-ansible';
import { getContentguardsCoreRbacListUrl } from '@pulp-ui/sdk/core/contentguards-rbac';
import type { AsyncOperationResponse } from '@pulp-ui/sdk/core/models/async-operation-response.zod';
import type { TaskResponse } from '@pulp-ui/sdk/core/models/tasks/task-response.zod';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import { getTasksReadUrl } from '@pulp-ui/sdk/core/tasks';
import { getDistributionsDebAptListUrl } from '@pulp-ui/sdk/deb/distributions-apt';
import { getPublicationsDebAptListUrl } from '@pulp-ui/sdk/deb/publications-apt';
import { getRemotesDebAptListUrl } from '@pulp-ui/sdk/deb/remotes-apt';
import { getRepositoriesDebAptListUrl } from '@pulp-ui/sdk/deb/repositories-apt';
import { getContentFileFilesCreateUrl } from '@pulp-ui/sdk/file/content-files';
import { getDistributionsFileFileListUrl } from '@pulp-ui/sdk/file/distributions-file';
import { getPublicationsFileFileListUrl } from '@pulp-ui/sdk/file/publications-file';
import { getRemotesFileFileListUrl } from '@pulp-ui/sdk/file/remotes-file';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { getDistributionsPythonPypiListUrl } from '@pulp-ui/sdk/python/distributions-pypi';
import { getPublicationsPythonPypiListUrl } from '@pulp-ui/sdk/python/publications-pypi';
import { getRemotesPythonPythonListUrl } from '@pulp-ui/sdk/python/remotes-python';
import { getRepositoriesPythonPythonListUrl } from '@pulp-ui/sdk/python/repositories-python';
import { getDistributionsRpmRpmListUrl } from '@pulp-ui/sdk/rpm/distributions-rpm';
import { getPublicationsRpmRpmListUrl } from '@pulp-ui/sdk/rpm/publications-rpm';
import { getRemotesRpmRpmListUrl } from '@pulp-ui/sdk/rpm/remotes-rpm';
import { getRepositoriesRpmRpmListUrl } from '@pulp-ui/sdk/rpm/repositories-rpm';
import { randomBytes } from 'node:crypto';
import { basicAuthorization } from '../../src/utilities/basic-authorization';
import { account } from './accounts';
import { origin } from './env';
import {
  apiCall,
  apiDelete,
  apiGet,
  apiPatch,
  apiPostForm,
  resolveApiUrl,
} from './sdk-request';

// Set-up and clean-up of the objects a remote test needs, through the REST API
// with the admin account of the run. Basic-authenticated calls carry no session
// and need no CSRF token. Every address comes from a URL builder of the
// generated client (or from a href the server returned) and every answer is
// typed by its models; sdk-request.ts sends them.
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

// What a task reports of itself that the helpers read; the rest of the model
// is the generated one.
type Task = TaskResponse & {
  state: string;
  created_resources: string[];
};

interface Page {
  results: PulpObject[];
  next: string | null;
}

// Endpoints that hold objects created by the tests, deepest dependants first:
// distributions, publications, repositories, remotes, content guards, roles. Only
// objects under these endpoints are ever deleted. Publications carry no name of
// their own; every other kind must carry the scope's prefix.
const DISTRIBUTIONS = [
  getDistributionsFileFileListUrl(),
  getDistributionsDebAptListUrl(),
  getDistributionsRpmRpmListUrl(),
  getDistributionsPythonPypiListUrl(),
];
const PUBLICATIONS = [
  getPublicationsFileFileListUrl(),
  getPublicationsDebAptListUrl(),
  getPublicationsRpmRpmListUrl(),
  getPublicationsPythonPypiListUrl(),
];
const REPOSITORIES = [
  getRepositoriesFileFileListUrl(),
  getRepositoriesDebAptListUrl(),
  getRepositoriesRpmRpmListUrl(),
  getRepositoriesPythonPythonListUrl(),
  getRepositoriesAnsibleAnsibleListUrl(),
];
const REMOTES = [
  getRemotesFileFileListUrl(),
  getRemotesDebAptListUrl(),
  getRemotesRpmRpmListUrl(),
  getRemotesPythonPythonListUrl(),
];
const CONTENT_GUARDS = [getContentguardsCoreRbacListUrl()];
const ROLES = [getRolesListUrl()];

// The endpoint groups in the order objects can be deleted.
const DELETION_ORDER = [
  DISTRIBUTIONS,
  PUBLICATIONS,
  REPOSITORIES,
  REMOTES,
  CONTENT_GUARDS,
  ROLES,
];

// The endpoints whose objects have a name, and so can be found by the scope's
// prefix, in deletion order.
const NAMED_DELETION_ORDER = DELETION_ORDER.filter(
  (endpoints) => endpoints !== PUBLICATIONS,
);
const NAMED_ENDPOINTS = NAMED_DELETION_ORDER.flat();

function groupOf(href: string): number {
  const target = resolveApiUrl(href);
  return DELETION_ORDER.findIndex((endpoints) =>
    endpoints.some((endpoint) => target.startsWith(endpoint)),
  );
}

// An address as a spec gives it: a builder's address or a server href, or a
// path below the API root.
function url(pathOrHref: string): string {
  return pathOrHref.startsWith('/') ? pathOrHref : `${API_BASE}${pathOrHref}`;
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
      const page = await apiGet<Page>(this.api, url(path), {
        ...params,
        limit: '100',
        offset: String(offset),
      });
      results.push(...page.results);
      if (!page.next) {
        return results;
      }
    }
  }

  async get(href: string): Promise<PulpObject> {
    return apiGet<PulpObject>(this.api, url(href));
  }

  // Waits for a task to finish and returns it; a failed or canceled task throws.
  async waitForTask(taskHref: string, timeoutMs = 120_000): Promise<Task> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const task = await apiGet<Task>(this.api, getTasksReadUrl(taskHref));
      if (task.state === 'completed') {
        return task;
      }
      if (task.state === 'failed' || task.state === 'canceled') {
        const description = (task.error as { description?: string } | undefined)
          ?.description;
        throw new Error(`task ${taskHref} ${task.state}: ${description ?? ''}`);
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

    const { status, body: answer } = await apiCall<
      PulpObject & AsyncOperationResponse
    >(this.api, 'POST', url(path), { data: body });
    if (status === 201) {
      this.registered.push(answer.pulp_href);
      return answer;
    }

    const task = await this.waitForTask(answer.task);
    const href = task.created_resources[0] as string;
    this.registered.push(href);
    return this.get(href);
  }

  // Changes an object and waits for the task the server starts.
  async patch(href: string, body: Record<string, unknown>) {
    const answer = await apiPatch<Partial<AsyncOperationResponse>>(
      this.api,
      url(href),
      body,
    );
    if (answer.task) {
      await this.waitForTask(answer.task);
    }
    return this.get(href);
  }

  // Deletes an object and waits for the task; an object that is already gone
  // is fine. An href outside the known endpoints, a named object outside this
  // scope and an unnamed object that is not a publication are refused.
  async remove(href: string): Promise<void> {
    const group = groupOf(href);
    if (group < 0) {
      throw new Error(`refusing to delete ${href}: not a known test endpoint`);
    }

    const current = await apiCall<PulpObject>(this.api, 'GET', url(href), {
      accept: [404],
    });
    if (current.status === 404) {
      return;
    }
    const { name } = current.body;
    // a publication belongs to a repository version and has no name
    const unnamedKind = DELETION_ORDER[group] === PUBLICATIONS;
    if (
      !unnamedKind &&
      (typeof name !== 'string' || !name.startsWith(this.prefix))
    ) {
      throw new Error(
        `refusing to delete ${href} named "${String(name)}": not under ${this.prefix}`,
      );
    }

    const answer = await apiDelete(this.api, url(href), [404]);
    if (answer.status === 202 && answer.body?.task) {
      await this.waitForTask(answer.body.task);
    }
  }

  // Uploads a small generated text file as a file content unit and adds it to
  // the repository as a new version; returns the finished task. The repository
  // must carry this scope's prefix, and the content always includes the prefix
  // so no unit is shared with an object of another run.
  async upload(
    repositoryHref: string,
    relativePath: string,
    text: string,
  ): Promise<Task> {
    const repository = await this.get(repositoryHref);
    if (
      groupOf(repositoryHref) !== DELETION_ORDER.indexOf(REPOSITORIES) ||
      typeof repository.name !== 'string' ||
      !repository.name.startsWith(this.prefix)
    ) {
      throw new Error(
        `refusing to upload to ${repositoryHref}: not a repository under ${this.prefix}`,
      );
    }

    const answer = await apiPostForm<AsyncOperationResponse>(
      this.api,
      getContentFileFilesCreateUrl(),
      {
        file: {
          name: relativePath.split('/').pop() as string,
          mimeType: 'text/plain',
          buffer: Buffer.from(`${this.prefix}${text}\n`),
        },
        relative_path: relativePath,
        repository: repositoryHref,
      },
    );
    return this.waitForTask(answer.task);
  }

  // Registers an object that something else created, for example the UI.
  track(href: string): void {
    this.registered.push(href);
  }

  // Objects of this scope that still exist, by endpoint.
  async leftovers(): Promise<string[]> {
    const found: string[] = [];
    for (const path of NAMED_ENDPOINTS) {
      const objects = await this.list(path, {
        name__startswith: this.prefix,
        fields: 'pulp_href,name',
      });
      found.push(...objects.map((object) => `${path}${object.name}`));
    }
    return found;
  }

  // Deletes everything this scope created: registered objects dependants first
  // (distributions, publications, repositories, remotes, content guards, roles), then
  // anything of the scope that is still listed, for objects created through
  // the UI. Throws when something is left; always closes the API context.
  async cleanUp(): Promise<void> {
    try {
      const ordered = [...this.registered].reverse();
      this.registered.length = 0;

      for (const group of DELETION_ORDER.keys()) {
        await Promise.all(
          ordered
            .filter((href) => groupOf(href) === group)
            .map((href) => this.remove(href)),
        );
      }
      const unknown = ordered.filter((href) => groupOf(href) < 0);
      if (unknown.length) {
        throw new Error(`registered but not deletable: ${unknown.join(', ')}`);
      }

      for (const endpoints of NAMED_DELETION_ORDER) {
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
