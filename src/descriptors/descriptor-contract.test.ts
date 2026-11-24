import type { MessageDescriptor } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import type { PluginDescriptor } from 'src/framework/descriptor';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';

// What every descriptor must hold so the generic screens can draw it: a label
// on every row, field and column, unique ids, tabs that are unique within the
// plugin, and nothing required of the parts a plugin may lack (sync,
// publication, a snippet), because maven, npm and ansible have no publication
// endpoint and need none of them.

const LOADERS: Record<string, () => Promise<{ default: PluginDescriptor }>> = {
  file: () => import('./file/descriptor'),
  deb: () => import('./deb/descriptor'),
  rpm: () => import('./rpm/descriptor'),
  python: () => import('./python/descriptor'),
  maven: () => import('./maven/descriptor'),
  npm: () => import('./npm/descriptor'),
  ansible: () => import('./ansible/descriptor'),
  container: () => import('./container/descriptor'),
};

function labelled(
  label: unknown,
  where: string,
): asserts label is { id: string } {
  expect(label, `${where} has a label`).toBeTruthy();
  expect(
    typeof (label as { id?: unknown }).id,
    `${where} label is a message`,
  ).toBe('string');
}

function unique(ids: string[], where: string) {
  expect(new Set(ids).size, `${where} ids are unique: ${ids.join(', ')}`).toBe(
    ids.length,
  );
}

// The checks every descriptor, real or declared, must pass.
function checkDescriptor(name: string, descriptor: PluginDescriptor) {
  const { repository } = descriptor;
  if (repository) {
    checkRepository(name, repository);
  }

  const { distribution } = descriptor;
  if (distribution) {
    expect(
      distribution.entity,
      `${name} has a distribution entity`,
    ).toBeTruthy();
    expect(distribution.entity.object).toBe('distribution');
    for (const column of distribution.columns ?? []) {
      labelled(column.label, `${name} distribution column ${column.id}`);
    }
  }

  const { remote } = descriptor;
  if (remote) {
    checkRemote(name, remote);
  }

  for (const type of descriptor.contentTypes ?? []) {
    labelled(type.label, `${name} content type ${type.id}`);
  }
}

function checkRepository(
  name: string,
  repository: NonNullable<PluginDescriptor['repository']>,
) {
  expect(repository.entity, `${name} has a repository entity`).toBeTruthy();
  expect(
    repository.detailRows.length,
    `${name} has detail rows`,
  ).toBeGreaterThan(0);
  for (const row of repository.detailRows) {
    labelled(row.label, `${name} detail row ${row.id}`);
    expect(typeof row.render).toBe('function');
  }
  unique(
    repository.detailRows.map(({ id }) => id),
    `${name} detail rows`,
  );

  for (const field of repository.fields ?? []) {
    labelled(field.label, `${name} field ${field.name}`);
    expect(field.kind, `${name} field ${field.name} has a kind`).toBeTruthy();
  }
  unique(
    (repository.fields ?? []).map(({ name: field }) => field),
    `${name} fields`,
  );

  for (const column of repository.columns ?? []) {
    labelled(column.label, `${name} column ${column.id}`);
  }
  unique(
    (repository.columns ?? []).map(({ id }) => id),
    `${name} columns`,
  );

  for (const filter of repository.filters ?? []) {
    labelled(filter.label, `${name} filter ${filter.id}`);
    expect(
      filter.param,
      `${name} filter ${filter.id} sets a parameter`,
    ).toBeTruthy();
  }

  for (const tab of repository.tabs ?? []) {
    labelled(tab.label, `${name} tab ${tab.id}`);
  }
  unique(
    (repository.tabs ?? []).map(({ id }) => id),
    `${name} tabs`,
  );
}

function checkRemote(
  name: string,
  remote: NonNullable<PluginDescriptor['remote']>,
) {
  {
    expect(remote.entity, `${name} has a remote entity`).toBeTruthy();
    for (const row of remote.detailRows ?? []) {
      labelled(row.label, `${name} remote detail row ${row.id}`);
      expect(typeof row.render).toBe('function');
    }
    unique(
      (remote.detailRows ?? []).map(({ id }) => id),
      `${name} remote detail rows`,
    );
    for (const column of remote.columns ?? []) {
      labelled(column.label, `${name} remote column ${column.id}`);
    }
    unique(
      (remote.columns ?? []).map(({ id }) => id),
      `${name} remote columns`,
    );
    for (const filter of remote.filters ?? []) {
      labelled(filter.label, `${name} remote filter ${filter.id}`);
      expect(
        filter.param,
        `${name} remote filter ${filter.id} sets a parameter`,
      ).toBeTruthy();
    }
  }
}

// A message descriptor as the message macro builds it, without extracting a
// message into the catalogs for a test.
const message = (id: string): MessageDescriptor => ({ id });

describe('Unit: plugin descriptors', { tags: ['unit'] }, () => {
  it.each(Object.keys(LOADERS))(
    'the %s descriptor holds what the screens need',
    async (plugin) => {
      const loader = LOADERS[plugin];
      expect(loader).toBeDefined();
      const { default: descriptor } = await (
        loader as NonNullable<typeof loader>
      )();

      checkDescriptor(plugin, descriptor);
    },
  );

  it('has a descriptor for every plugin that is on the framework', () => {
    for (const { plugin, onFramework } of PLUGIN_MANIFESTS) {
      if (onFramework) {
        expect(LOADERS[plugin], `${plugin} has a descriptor`).toBeDefined();
      }
    }
  });

  it('requires every descriptor to declare the kinds of object its manifest lists', async () => {
    for (const { plugin, resources } of PLUGIN_MANIFESTS) {
      const loader = LOADERS[plugin] as NonNullable<(typeof LOADERS)[string]>;
      const { default: descriptor } = await loader();

      expect(
        descriptor.distribution !== undefined,
        `${plugin} distribution`,
      ).toBe(resources.includes('distribution'));
      expect(descriptor.repository !== undefined, `${plugin} repository`).toBe(
        resources.includes('repository'),
      );
      expect(descriptor.remote !== undefined, `${plugin} remote`).toBe(
        resources.includes('remote'),
      );
    }
  });

  it('accepts a descriptor that declares only a distribution', () => {
    const entity = {
      app: 'maven',
      object: 'distribution',
    } as unknown as NonNullable<PluginDescriptor['distribution']>['entity'];
    const distributionOnly: PluginDescriptor = { distribution: { entity } };

    expect(distributionOnly.repository).toBeUndefined();
    expect(() => checkDescriptor('maven', distributionOnly)).not.toThrow();
  });

  it('accepts a plugin with no publication, no sync and no snippet, and its own tabs and content types', () => {
    // The shape of a plugin like maven: nothing is served from a publication,
    // nothing is synced, and its tabs and content types are its own.
    const entity = {
      app: 'maven',
      object: 'repository',
    } as unknown as NonNullable<PluginDescriptor['repository']>['entity'];
    const publicationLess: PluginDescriptor = {
      repository: {
        entity,
        detailRows: [
          {
            id: 'name',
            label: message('Repository name'),
            render: (row) => row.name,
          },
        ],
        tabs: [
          {
            id: 'packages',
            label: message('Artifacts'),
            render: () => null,
          },
        ],
      },
      contentTypes: [{ id: 'artifact', label: message('Artifacts') }],
    };

    expect(publicationLess.publication).toBeUndefined();
    expect(publicationLess.repository?.sync).toBeUndefined();
    expect(publicationLess.repository?.snippet).toBeUndefined();
    expect(() => checkDescriptor('maven', publicationLess)).not.toThrow();
  });

  it('rejects a row without a label and two tabs with one address', () => {
    const entity = {} as NonNullable<PluginDescriptor['repository']>['entity'];
    const unlabelled = {
      repository: {
        entity,
        detailRows: [{ id: 'name', render: () => null }],
      },
    } as unknown as PluginDescriptor;
    const twice = {
      repository: {
        entity,
        detailRows: [
          { id: 'name', label: message('Name'), render: () => null },
        ],
        tabs: [
          { id: 'packages', label: message('A'), render: () => null },
          { id: 'packages', label: message('B'), render: () => null },
        ],
      },
    } as PluginDescriptor;

    expect(() => checkDescriptor('x', unlabelled)).toThrow();
    expect(() => checkDescriptor('x', twice)).toThrow();
  });
});

const PUBLISHING = ['file', 'deb', 'rpm'];
const NOT_PUBLISHING = ['python', 'maven', 'npm', 'ansible', 'container'];

async function descriptorOf(plugin: string): Promise<PluginDescriptor> {
  const loader = LOADERS[plugin] as NonNullable<(typeof LOADERS)[string]>;
  return (await loader()).default;
}

describe(
  'Unit: publishing and autopublish in the descriptors',
  { tags: ['unit'] },
  () => {
    it.each(PUBLISHING)(
      'the %s descriptor can publish, names the task and labels every option',
      async (plugin) => {
        const { publication } = await descriptorOf(plugin);

        expect(publication?.entity.create, `${plugin} creates`).toBeTypeOf(
          'function',
        );
        expect(publication?.taskName).toMatch(/\.publishing\.publish$/);
        expect(publication?.options?.length).toBeGreaterThan(0);
        for (const option of publication?.options ?? []) {
          labelled(option.label, `${plugin} publish option ${option.name}`);
          expect(typeof option.initial).toBe('function');
          if (option.kind === 'select') {
            expect(option.options?.length).toBeGreaterThan(0);
          }
        }
        unique(
          (publication?.options ?? []).map(({ name }) => name),
          `${plugin} publish options`,
        );
      },
    );

    it.each(NOT_PUBLISHING)(
      'the %s descriptor has no Publish',
      async (plugin) => {
        const { publication } = await descriptorOf(plugin);

        expect(publication?.entity.create, `${plugin} creates`).toBeUndefined();
        expect(publication?.options).toBeUndefined();
        expect(publication?.taskName).toBeUndefined();
      },
    );

    it.each(PUBLISHING)(
      'the %s repository shows Autopublish and its form edits it',
      async (plugin) => {
        const { repository } = await descriptorOf(plugin);

        expect(
          repository?.detailRows.some(({ id }) => id === 'autopublish'),
        ).toBe(true);
        expect(
          repository?.fields?.some(({ name }) => name === 'autopublish'),
        ).toBe(true);
      },
    );

    it('the python repository shows no Autopublish and its form has none', async () => {
      const { repository } = await descriptorOf('python');

      expect(
        repository?.detailRows.some(({ id }) => id === 'autopublish'),
      ).toBe(false);
      expect(
        repository?.fields?.some(({ name }) => name === 'autopublish'),
      ).toBeFalsy();
    });
  },
);
