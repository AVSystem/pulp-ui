// @vitest-environment node
// A plugin whose screens come from its descriptor has no screens of its own:
// its repositories and remotes are drawn by the generic list, detail and form,
// and a folder of per-plugin containers or a per-plugin action next to them
// would be a second implementation that can drift from the first. This test
// reads the source tree and fails when one of the old files of a plugin that is
// on the framework is there again.
import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLUGIN_MANIFESTS } from '../src/framework/manifest';

const SRC = resolve(import.meta.dirname, '..', 'src');

// What of a plugin's old screens exists in the given lists of names: the
// container folders of its repositories and remotes, and the actions that were
// cloned for each.
function leftovers(
  plugin: string,
  containers: readonly string[],
  actions: readonly string[],
): string[] {
  return [
    ...containers
      .filter((name) =>
        [`${plugin}-repository`, `${plugin}-remote`].includes(name),
      )
      .map((name) => `src/containers/${name}`),
    ...actions
      .filter((name) =>
        new RegExp(`^${plugin}-(repository|remote)-`).test(name),
      )
      .map((name) => `src/actions/${name}`),
  ];
}

const names = (dir: string) => readdirSync(join(SRC, dir));

describe(
  'Unit: containers of plugins on the framework',
  { tags: ['unit'] },
  () => {
    it('reports a container folder and an action of a plugin it is given', () => {
      expect(
        leftovers(
          'file',
          [
            'file-repository',
            'file-remote',
            'ansible-remote',
            'about-project.tsx',
          ],
          ['file-repository-sync.tsx', 'file-remote-create.tsx', 'action.tsx'],
        ),
      ).toEqual([
        'src/containers/file-repository',
        'src/containers/file-remote',
        'src/actions/file-repository-sync.tsx',
        'src/actions/file-remote-create.tsx',
      ]);
    });

    it('does not take the files of another plugin for its own', () => {
      expect(
        leftovers(
          'file',
          ['deb-repository', 'python-remote', 'profile-repository'],
          ['deb-repository-sync.tsx', 'filesystem-remote-x.tsx'],
        ),
      ).toEqual([]);
    });

    it('has at least one plugin on the framework, so the guard is not empty', () => {
      expect(PLUGIN_MANIFESTS.some(({ onFramework }) => onFramework)).toBe(
        true,
      );
    });

    it.each(
      PLUGIN_MANIFESTS.filter(({ onFramework }) => onFramework).map(
        ({ plugin }) => plugin,
      ),
    )('leaves no container folder and no action of the %s plugin', (plugin) => {
      expect(leftovers(plugin, names('containers'), names('actions'))).toEqual(
        [],
      );
    });
  },
);
