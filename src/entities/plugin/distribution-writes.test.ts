import { HttpResponse, http } from 'msw';
import { describe, expect, it } from 'vitest';
import { ansibleDistribution } from 'src/entities/ansible/distribution';
import { containerDistribution } from 'src/entities/container/distribution';
import { debDistribution } from 'src/entities/deb/distribution';
import { fileDistribution } from 'src/entities/file/distribution';
import { mavenDistribution } from 'src/entities/maven/distribution';
import { npmDistribution } from 'src/entities/npm/distribution';
import { pythonDistribution } from 'src/entities/python/distribution';
import { rpmDistribution } from 'src/entities/rpm/distribution';
import {
  type TestDistributionPlugin,
  distributionListHandler,
  pluginDistribution,
} from 'src/test-utils/pulp';
import { server } from 'src/test-utils/server';
import {
  type BindingField,
  DISTRIBUTION_BINDINGS,
  type DistributionBase,
  type DistributionCreate,
  type DistributionEntity,
  bindingChange,
  distributionCreateBody,
} from './distribution';

const TASK = '/pulp/api/v3/tasks/00000000-0000-4000-8000-00000000d001/';
const REPOSITORY =
  '/pulp/api/v3/repositories/file/file/00000000-0000-4000-8000-00000000a001/';
const PUBLICATION =
  '/pulp/api/v3/publications/file/file/00000000-0000-4000-8000-00000000a002/';
const VERSION = `${REPOSITORY}versions/3/`;
const GUARD =
  '/pulp/api/v3/contentguards/core/rbac/00000000-0000-4000-8000-00000000a003/';

type AnyEntity = DistributionEntity<
  DistributionBase,
  DistributionCreate,
  Record<string, unknown>
>;

// The entities have the body types of their own generated clients; the tests
// drive them all through the one shape the screens use.
const ENTITIES: Record<TestDistributionPlugin, AnyEntity> = {
  file: fileDistribution as unknown as AnyEntity,
  deb: debDistribution as unknown as AnyEntity,
  rpm: rpmDistribution as unknown as AnyEntity,
  python: pythonDistribution as unknown as AnyEntity,
  maven: mavenDistribution as unknown as AnyEntity,
  npm: npmDistribution as unknown as AnyEntity,
  ansible: ansibleDistribution as unknown as AnyEntity,
  container: containerDistribution as unknown as AnyEntity,
};

const PLUGINS = Object.keys(ENTITIES) as TestDistributionPlugin[];

const SEGMENTS: Record<TestDistributionPlugin, string> = {
  file: 'file/file',
  deb: 'deb/apt',
  rpm: 'rpm/rpm',
  python: 'python/pypi',
  maven: 'maven/maven',
  npm: 'npm/npm',
  ansible: 'ansible/ansible',
  container: 'container/container',
};

const WITH_PUBLICATION = ['file', 'deb', 'rpm', 'python'];

const BINDINGS: Record<BindingField, string> = {
  repository: REPOSITORY,
  publication: PUBLICATION,
  repository_version: VERSION,
};

// The body and the address of every request a handler answers.
function recorder() {
  const seen: { method: string; pathname: string; body: unknown }[] = [];
  return {
    seen,
    async record(request: Request) {
      const text = await request.clone().text();
      seen.push({
        method: request.method,
        pathname: new URL(request.url).pathname,
        body: text ? JSON.parse(text) : undefined,
      });
    },
  };
}

const sorted = (keys: readonly string[]) => [...keys].sort();

describe('Unit: the binding fields of each plugin', { tags: ['unit'] }, () => {
  it('are the three bindings for plugins that serve publications', () => {
    for (const plugin of WITH_PUBLICATION) {
      expect(sorted(DISTRIBUTION_BINDINGS[plugin] ?? [])).toEqual([
        'publication',
        'repository',
        'repository_version',
      ]);
    }
  });

  it('are the repository and the version for plugins that serve versions directly', () => {
    for (const plugin of ['maven', 'npm', 'ansible', 'container']) {
      expect(sorted(DISTRIBUTION_BINDINGS[plugin] ?? [])).toEqual([
        'repository',
        'repository_version',
      ]);
    }
  });
});

describe(
  'Unit: a change of what a distribution serves',
  { tags: ['unit'] },
  () => {
    it('names the new publication and clears the other two bindings of a file distribution', () => {
      expect(bindingChange('file', { publication: PUBLICATION })).toStrictEqual(
        {
          publication: PUBLICATION,
          repository: null,
          repository_version: null,
        },
      );
    });

    it('names the new repository of a maven distribution and has no publication key', () => {
      const body = bindingChange('maven', { repository: REPOSITORY });

      expect(body).toStrictEqual({
        repository: REPOSITORY,
        repository_version: null,
      });
      expect('publication' in body).toBe(false);
    });

    const cases = PLUGINS.flatMap((plugin) =>
      (DISTRIBUTION_BINDINGS[plugin] ?? []).map(
        (binding) => [plugin, binding] as const,
      ),
    );

    it('has a case for every binding of every plugin', () => {
      expect(cases).toHaveLength(4 * 3 + 4 * 2);
    });

    it.each(cases)(
      'carries only the fields %s has, the %s set and every other binding null',
      (plugin, binding) => {
        const body = bindingChange(plugin, { [binding]: BINDINGS[binding] });

        expect(sorted(Object.keys(body))).toEqual(
          sorted(DISTRIBUTION_BINDINGS[plugin] ?? []),
        );
        for (const [field, value] of Object.entries(body)) {
          expect(value).toBe(field === binding ? BINDINGS[binding] : null);
        }
      },
    );

    it('refuses a binding the plugin has no field for', () => {
      expect(() =>
        bindingChange('maven', { publication: PUBLICATION }),
      ).toThrow(/publication/);
    });

    it('refuses no binding, two bindings and an empty address', () => {
      expect(() => bindingChange('file', {})).toThrow();
      expect(() =>
        bindingChange('file', {
          repository: REPOSITORY,
          publication: PUBLICATION,
        }),
      ).toThrow();
      expect(() => bindingChange('file', { repository: '' })).toThrow();
    });

    it('refuses a plugin it does not know', () => {
      expect(() => bindingChange('cargo', { repository: REPOSITORY })).toThrow(
        /cargo/,
      );
    });
  },
);

describe('Unit: the body of a distribution create', { tags: ['unit'] }, () => {
  it('holds exactly the fields given', () => {
    const body = distributionCreateBody({
      name: 'stable',
      base_path: 'stable',
      content_guard: GUARD,
      repository: REPOSITORY,
    });

    expect(Object.keys(body).sort()).toEqual([
      'base_path',
      'content_guard',
      'name',
      'repository',
    ]);
    expect(body).toStrictEqual({
      name: 'stable',
      base_path: 'stable',
      content_guard: GUARD,
      repository: REPOSITORY,
    });
  });

  it('has no content guard key when none is given, so the server decides', () => {
    const body = distributionCreateBody({
      name: 'stable',
      base_path: 'stable',
      repository: REPOSITORY,
    });

    expect('content_guard' in body).toBe(false);
  });

  it('sends no guard only when the caller says so with an explicit null', () => {
    const body = distributionCreateBody({
      name: 'stable',
      base_path: 'stable',
      content_guard: null,
      repository: REPOSITORY,
    });

    expect(body).toStrictEqual({
      name: 'stable',
      base_path: 'stable',
      content_guard: null,
      repository: REPOSITORY,
    });
  });

  it('includes labels only when some are given', () => {
    const base = {
      name: 'stable',
      base_path: 'stable',
      repository: REPOSITORY,
    };

    expect('pulp_labels' in distributionCreateBody(base)).toBe(false);
    expect(
      'pulp_labels' in distributionCreateBody({ ...base, pulp_labels: {} }),
    ).toBe(false);
    expect(
      distributionCreateBody({ ...base, pulp_labels: { team: 'ops' } }),
    ).toStrictEqual({ ...base, pulp_labels: { team: 'ops' } });
  });

  it('carries a publication binding instead of a repository when that is the one given', () => {
    expect(
      distributionCreateBody({
        name: 'stable',
        base_path: 'stable',
        publication: PUBLICATION,
      }),
    ).toStrictEqual({
      name: 'stable',
      base_path: 'stable',
      publication: PUBLICATION,
    });
  });
});

describe.each(PLUGINS)(
  'Unit: the %s distribution entity',
  { tags: ['unit'] },
  (plugin) => {
    const entity = ENTITIES[plugin];
    const collection = `/pulp/api/v3/distributions/${SEGMENTS[plugin]}/`;

    it('names the plugin and the object it keys its reads by', () => {
      expect(entity.app).toBe(plugin);
      expect(entity.object).toBe('distribution');
    });

    it('lists the distributions of the plugin and reads one by its address', async () => {
      const row = pluginDistribution(plugin, { name: 'stable' });
      const list = distributionListHandler(plugin, [row]);
      server.use(
        list.handler,
        http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)),
      );

      const listed = await entity.list({});
      const read = await entity.retrieve(row.pulp_href);

      expect(list.path).toBe(collection);
      expect(listed.results.map(({ name }) => name)).toEqual(['stable']);
      expect(read).toMatchObject({ name: 'stable', pulp_href: row.pulp_href });
    });

    it('creates with exactly the fields given and resolves with the task', async () => {
      const calls = recorder();
      server.use(
        http.post(`*${collection}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      const task = await entity.create(
        distributionCreateBody({
          name: 'stable',
          base_path: 'stable',
          repository: REPOSITORY,
        }),
      );

      expect(task).toBe(TASK);
      expect(calls.seen).toEqual([
        {
          method: 'POST',
          pathname: collection,
          body: { name: 'stable', base_path: 'stable', repository: REPOSITORY },
        },
      ]);
    });

    it('changes what it serves with the new repository and null for every other binding it has', async () => {
      const row = pluginDistribution(plugin);
      const calls = recorder();
      server.use(
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      const result = await entity.update(
        row.pulp_href,
        bindingChange(plugin, { repository: REPOSITORY }),
      );

      const others = (DISTRIBUTION_BINDINGS[plugin] ?? []).filter(
        (field) => field !== 'repository',
      );
      expect(result).toEqual({ kind: 'task', task: TASK });
      expect(calls.seen).toEqual([
        {
          method: 'PATCH',
          pathname: row.pulp_href,
          body: {
            repository: REPOSITORY,
            ...Object.fromEntries(others.map((field) => [field, null])),
          },
        },
      ]);
    });

    it('sends only the fields of a change that is not a binding change', async () => {
      const row = pluginDistribution(plugin);
      const calls = recorder();
      server.use(
        http.patch(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      await entity.update(row.pulp_href, { base_path: 'moved' });

      expect(calls.seen.map(({ body }) => body)).toEqual([
        { base_path: 'moved' },
      ]);
    });

    it('deletes by the address and resolves with the task', async () => {
      const row = pluginDistribution(plugin);
      const calls = recorder();
      server.use(
        http.delete(`*${row.pulp_href}`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ task: TASK }, { status: 202 });
        }),
      );

      expect(await entity.remove(row.pulp_href)).toBe(TASK);
      expect(calls.seen).toEqual([
        { method: 'DELETE', pathname: row.pulp_href, body: undefined },
      ]);
    });

    it('sets and unsets a label on the distribution itself and returns the label', async () => {
      const row = pluginDistribution(plugin);
      const calls = recorder();
      server.use(
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'team', value: 'ops' });
        }),
        http.post(`*${row.pulp_href}unset_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'team', value: 'ops' });
        }),
      );

      const set = await entity.setLabel(row.pulp_href, {
        key: 'team',
        value: 'ops',
      });
      const unset = await entity.unsetLabel(row.pulp_href, 'team');

      expect(set).toEqual({ key: 'team', value: 'ops' });
      expect(unset).toEqual({ key: 'team', value: 'ops' });
      expect(calls.seen).toEqual([
        {
          method: 'POST',
          pathname: `${row.pulp_href}set_label/`,
          body: { key: 'team', value: 'ops' },
        },
        {
          method: 'POST',
          pathname: `${row.pulp_href}unset_label/`,
          body: { key: 'team' },
        },
      ]);
    });

    it('sets a label with no value as null', async () => {
      const row = pluginDistribution(plugin);
      const calls = recorder();
      server.use(
        http.post(`*${row.pulp_href}set_label/`, async ({ request }) => {
          await calls.record(request);
          return HttpResponse.json({ key: 'flag', value: null });
        }),
      );

      const set = await entity.setLabel(row.pulp_href, {
        key: 'flag',
        value: null,
      });

      expect(set).toEqual({ key: 'flag', value: null });
      expect(calls.seen.map(({ body }) => body)).toEqual([
        { key: 'flag', value: null },
      ]);
    });
  },
);

describe('Unit: the address a client uses', { tags: ['unit'] }, () => {
  it('is the client URL an ansible distribution reports, never its base URL', () => {
    const row = pluginDistribution('ansible', {
      base_url: 'https://pulp.example/pulp/content/galaxy/',
      client_url: 'https://pulp.example/pulp_ansible/galaxy/galaxy/',
    });

    expect(ansibleDistribution.clientUrlOf(row as DistributionBase)).toBe(
      'https://pulp.example/pulp_ansible/galaxy/galaxy/',
    );
  });

  it('is nothing for an ansible distribution that reports no client URL', () => {
    const { client_url: _unused, ...row } = pluginDistribution('ansible', {
      base_url: 'https://pulp.example/pulp/content/galaxy/',
    });

    expect(ansibleDistribution.clientUrlOf(row as DistributionBase)).toBeNull();
  });

  it('parses the client URL of an ansible row and keeps it on the parsed row', async () => {
    const row = pluginDistribution('ansible', { name: 'galaxy' });
    server.use(http.get(`*${row.pulp_href}`, () => HttpResponse.json(row)));

    const read = await ansibleDistribution.retrieve(row.pulp_href);

    expect(ansibleDistribution.clientUrlOf(read)).toBe(row.client_url);
  });

  it('is the base URL for every other plugin', () => {
    for (const plugin of PLUGINS.filter((name) => name !== 'ansible')) {
      const row = pluginDistribution(plugin, {
        base_url: 'https://pulp.example/pulp/content/stable/',
      });

      expect(ENTITIES[plugin].clientUrlOf(row as DistributionBase)).toBe(
        'https://pulp.example/pulp/content/stable/',
      );
    }
  });
});
