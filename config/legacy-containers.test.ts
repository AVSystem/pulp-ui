// @vitest-environment node
// A plugin whose repository and remote screens come from its descriptor has no
// screens of its own for them: its repositories and remotes are drawn by the generic list, detail and form,
// and a folder of per-plugin containers or a per-plugin action next to them
// would be a second implementation that can drift from the first. This test
// reads the source tree and fails when one of the old files of a plugin that is
// on the framework is there again.
import { existsSync, readdirSync } from 'node:fs';
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
      expect(
        PLUGIN_MANIFESTS.some(({ resources }) =>
          resources.includes('repository'),
        ),
      ).toBe(true);
    });

    // The lists of all the content of a plugin are one generic screen. A list of
    // packages of one plugin next to it would read a row at a time again.
    it.each(['python', 'rpm'])(
      'leaves no list of packages in the %s container folder',
      (plugin) => {
        expect(
          (existsSync(join(SRC, 'containers', plugin))
            ? names(join('containers', plugin))
            : []
          )
            .filter((name) => name.startsWith('package-list'))
            .map((name) => `src/containers/${plugin}/${name}`),
        ).toEqual([]);
      },
    );

    // The signature keys screen is drawn by the framework from the typed
    // signing service entity. A container of its own, or the old request
    // module behind it, would be a second implementation that can hide a
    // failed read as an empty list again.
    it.each(['containers/signature-keys', 'api/signing-service.ts'])(
      'leaves no %s in the source tree',
      (path) => {
        expect(existsSync(join(SRC, path))).toBe(false);
      },
    );

    // A plugin that has only distributions on the framework keeps its own
    // repository and remote screens, so the guard does not apply to them.
    it.each(
      PLUGIN_MANIFESTS.filter(
        ({ resources }) =>
          resources.includes('repository') || resources.includes('remote'),
      ).map(({ plugin }) => plugin),
    )('leaves no container folder and no action of the %s plugin', (plugin) => {
      expect(leftovers(plugin, names('containers'), names('actions'))).toEqual(
        [],
      );
    });
  },
);
