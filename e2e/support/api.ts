import { type APIRequestContext, request } from '@playwright/test';
import { getDistributionsAnsibleAnsibleListUrl } from '@pulp-ui/sdk/ansible/distributions-ansible';
import { getRepositoriesAnsibleAnsibleListUrl } from '@pulp-ui/sdk/ansible/repositories-ansible';
import { getDistributionsContainerContainerListUrl } from '@pulp-ui/sdk/container/distributions-container';
import { getRepositoriesContainerContainerListUrl } from '@pulp-ui/sdk/container/repositories-container';
import { getContentListUrl } from '@pulp-ui/sdk/core/content';
import { getContentguardsCoreRbacListUrl } from '@pulp-ui/sdk/core/contentguards-rbac';
import { getGroupsListUrl } from '@pulp-ui/sdk/core/groups';
import type { AsyncOperationResponse } from '@pulp-ui/sdk/core/models/async-operation-response.zod';
import type { TaskResponse } from '@pulp-ui/sdk/core/models/tasks/task-response.zod';
import { getOrphansCleanupCleanupUrl } from '@pulp-ui/sdk/core/orphans-cleanup';
import { getRolesListUrl } from '@pulp-ui/sdk/core/roles';
import { getTasksReadUrl } from '@pulp-ui/sdk/core/tasks';
import { getUsersListUrl } from '@pulp-ui/sdk/core/users';
import { getDistributionsDebAptListUrl } from '@pulp-ui/sdk/deb/distributions-apt';
import { getPublicationsDebAptListUrl } from '@pulp-ui/sdk/deb/publications-apt';
import { getRemotesDebAptListUrl } from '@pulp-ui/sdk/deb/remotes-apt';
import { getRepositoriesDebAptListUrl } from '@pulp-ui/sdk/deb/repositories-apt';
import {
  getContentFileFilesCreateUrl,
  getContentFileFilesListUrl,
} from '@pulp-ui/sdk/file/content-files';
import { getDistributionsFileFileListUrl } from '@pulp-ui/sdk/file/distributions-file';
import { getPublicationsFileFileListUrl } from '@pulp-ui/sdk/file/publications-file';
import { getRemotesFileFileListUrl } from '@pulp-ui/sdk/file/remotes-file';
import { getRepositoriesFileFileListUrl } from '@pulp-ui/sdk/file/repositories-file';
import { getDistributionsMavenMavenListUrl } from '@pulp-ui/sdk/maven/distributions-maven';
import { getRepositoriesMavenMavenListUrl } from '@pulp-ui/sdk/maven/repositories-maven';
import { getDistributionsNpmNpmListUrl } from '@pulp-ui/sdk/npm/distributions-npm';
import { getRepositoriesNpmNpmListUrl } from '@pulp-ui/sdk/npm/repositories-npm';
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
  apiPost,
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

// Endpoints of plugins a deployment may leave out; a list the server does not
// know holds nothing to clean up.
const OPTIONAL_ENDPOINTS: string[] = [
  getDistributionsContainerContainerListUrl(),
  getRepositoriesContainerContainerListUrl(),
];

// Every object of a list endpoint matching the filters, all pages, read with
// any request context (the one of the account a spec signs in with).
export async function listAll(
  api: APIRequestContext,
  path: string,
  params: Record<string, string> = {},
): Promise<PulpObject[]> {
  const results: PulpObject[] = [];
  for (let offset = 0; ; offset += 100) {
    const answer = await apiCall<Page>(api, 'GET', url(path), {
      params: { ...params, limit: '100', offset: String(offset) },
      accept: OPTIONAL_ENDPOINTS.includes(path) ? [404] : [],
    });
    // a plugin the deployment does not have answers 404 for its lists
    if (answer.status === 404) {
      return results;
    }
    const page = answer.body;
    results.push(...page.results);
    if (!page.next) {
      return results;
    }
  }
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
// groups, users, distributions, publications, repositories, remotes, content
// guards, roles. Only objects under these endpoints are ever deleted.
// Publications carry no name of their own; users are named by their user name;
// every other kind must carry the scope's prefix in its name.
const DISTRIBUTIONS = [
  getDistributionsFileFileListUrl(),
  getDistributionsDebAptListUrl(),
  getDistributionsRpmRpmListUrl(),
  getDistributionsPythonPypiListUrl(),
  getDistributionsMavenMavenListUrl(),
  getDistributionsNpmNpmListUrl(),
  getDistributionsAnsibleAnsibleListUrl(),
  getDistributionsContainerContainerListUrl(),
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
  getRepositoriesMavenMavenListUrl(),
  getRepositoriesNpmNpmListUrl(),
  getRepositoriesContainerContainerListUrl(),
];
const REMOTES = [
  getRemotesFileFileListUrl(),
  getRemotesDebAptListUrl(),
  getRemotesRpmRpmListUrl(),
  getRemotesPythonPythonListUrl(),
];
const CONTENT_GUARDS = [getContentguardsCoreRbacListUrl()];
const ROLES = [getRolesListUrl()];
const GROUPS = [getGroupsListUrl()];
const USERS = [getUsersListUrl()];

// The endpoint groups in the order objects can be deleted.
const DELETION_ORDER = [
  GROUPS,
  USERS,
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

// The field that names an object of this endpoint, and the filter that finds
// the objects whose name starts with a prefix. Users and groups are matched on
// "contains" and checked again by the caller, because their filters offer no
// "startswith".
function nameField(path: string): 'username' | 'name' {
  return USERS.some((endpoint) => path.startsWith(endpoint))
    ? 'username'
    : 'name';
}

function prefixFilter(path: string, prefix: string): Record<string, string> {
  const field = nameField(path);
  const matching = field === 'username' || GROUPS.includes(path);
  return {
    [`${field}__${matching ? 'contains' : 'startswith'}`]: prefix,
    fields: `pulp_href,${field}`,
  };
}

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

// Waits for every job, then rethrows the first failure. Used for creates that
// run side by side: `Promise.all` would report the first failure at once while
// the other creates are still running, and an object whose task finishes after
// the clean-up has started would never be registered and stay on the server.
export async function allSettled<T>(jobs: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(jobs);
  const failure = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failure) {
    throw failure.reason;
  }
  return results.map((result) => (result as PromiseFulfilledResult<T>).value);
}

// The objects of one spec file on one deployment. Create them through this
// class, call cleanUp() in afterAll.
export class TestObjects {
  private readonly registered: string[] = [];
  private readonly content = new Set<string>();

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
  list(path: string, params: Record<string, string> = {}) {
    return listAll(this.api, path, params);
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
    const label = body[nameField(url(path))];
    if (typeof label === 'string' && !label.startsWith(this.prefix)) {
      throw new Error(
        `refusing to create "${label}": not under ${this.prefix}`,
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
    const name = current.body[nameField(href)];
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

  // A file repository of this scope with one generated file per path, each
  // uploaded on its own so every file makes a version of its own: version n
  // holds the first n files. The path of a file is the scope's prefix and the
  // name given, so no unit is shared with an object of another run; the same
  // name in two repositories of one run is one unit.
  async fileRepository(
    suffix: string,
    names: string[],
    extra: Record<string, unknown> = {},
  ): Promise<PulpObject> {
    const repository = await this.create(getRepositoriesFileFileListUrl(), {
      name: this.name(suffix),
      ...extra,
    });
    for (const name of names) {
      await this.upload(repository.pulp_href, this.path(name), name);
    }
    return repository;
  }

  // The relative path a generated file of this scope carries.
  path(name: string): string {
    return `${this.prefix}${name}`;
  }

  // The numbers of the versions a repository holds, newest first.
  async versionNumbers(repositoryHref: string): Promise<number[]> {
    const versions = await this.list(`${repositoryHref}versions/`, {
      fields: 'number',
    });
    return versions
      .map(({ number }) => Number(number))
      .sort((left, right) => right - left);
  }

  // The content units of any type a repository version holds.
  async versionContent(versionHref: string): Promise<string[]> {
    const units = await this.list(getContentListUrl(), {
      repository_version: versionHref,
      fields: 'pulp_href',
    });
    return units.map(({ pulp_href }) => pulp_href);
  }

  // Names content units of this run that clean-up removes once no repository
  // holds them, for units whose type has no path to find them by.
  trackContent(hrefs: string[]): void {
    for (const href of hrefs) {
      this.content.add(href);
    }
  }

  // The content units of this scope: file units found by the prefix of their
  // path, and the units the spec named.
  private async ownedContent(): Promise<string[]> {
    const files = await this.list(getContentFileFilesListUrl(), {
      relative_path__startswith: this.prefix,
      fields: 'pulp_href',
    });
    return [
      ...new Set([...files.map(({ pulp_href }) => pulp_href), ...this.content]),
    ];
  }

  // Removes the content units of this scope once no repository holds them.
  // Only the listed units are named to the orphan clean-up, so no content of
  // another run or of the lab is touched; a unit that is still held stays and
  // is reported.
  private async removeContent(): Promise<void> {
    const units = await this.ownedContent();
    if (units.length === 0) {
      return;
    }
    const answer = await apiPost<AsyncOperationResponse>(
      this.api,
      getOrphansCleanupCleanupUrl(),
      { content_hrefs: units, orphan_protection_time: 0 },
    );
    await this.waitForTask(answer.task);
    const left = await Promise.all(
      units.map((href) =>
        apiCall<PulpObject>(this.api, 'GET', url(href), { accept: [404] }),
      ),
    );
    const held = units.filter((_, index) => left[index]?.status !== 404);
    if (held.length > 0) {
      throw new Error(
        `content left on the server after clean-up: ${held.join(', ')}`,
      );
    }
  }

  // Registers an object that something else created, for example the UI.
  track(href: string): void {
    this.registered.push(href);
  }

  // The objects of one endpoint that carry this scope's prefix.
  private async owned(path: string): Promise<PulpObject[]> {
    const field = nameField(path);
    const objects = await this.list(path, prefixFilter(path, this.prefix));
    return objects.filter((object) =>
      String(object[field] ?? '').startsWith(this.prefix),
    );
  }

  // Objects of this scope that still exist, by endpoint.
  async leftovers(): Promise<string[]> {
    const found: string[] = [];
    for (const path of NAMED_ENDPOINTS) {
      const field = nameField(path);
      const objects = await this.owned(path);
      found.push(...objects.map((object) => `${path}${String(object[field])}`));
    }
    return found;
  }

  // Deletes everything this scope created: registered objects dependants first
  // (groups, users, distributions, publications, repositories, remotes, content
  // guards, roles), then
  // anything of the scope that is still listed, for objects created through
  // the UI. Throws when something is left; always closes the API context.
  // `fileContent` also removes the file content units whose path carries the
  // scope's prefix, for a spec that uploads files.
  async cleanUp({ fileContent = false } = {}): Promise<void> {
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
          const objects = await this.owned(path);
          await Promise.all(
            objects.map(({ pulp_href }) => this.remove(pulp_href)),
          );
        }
      }

      if (fileContent || this.content.size > 0) {
        await this.removeContent();
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
