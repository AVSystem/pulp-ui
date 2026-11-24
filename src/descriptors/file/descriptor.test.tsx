import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { pluginRemote, pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import descriptor from './descriptor';

// The file plugin's descriptor is what the generic screens draw its
// repositories and remotes from, so each part of it is checked here as the
// screens use it: the form fields, the Details rows, the list columns and
// filters, the options of the sync dialog, the command snippet and the tabs.

const text = (label: MessageDescriptor) => i18n._(label);

const { repository, remote } = descriptor;

// A file repository as the server returns it, with the fields only file has.
const FILE_REPOSITORY = {
  ...pluginRepository('file', { name: 'manuals' }),
  autopublish: false,
  sha256sums: 'disabled',
};

function shown(node: ReactNode): HTMLElement {
  renderWithProviders(<div data-testid='shown'>{node}</div>);
  return screen.getByTestId('shown');
}

describe('Unit: the file descriptor', { tags: ['unit'] }, () => {
  describe('the repository form', () => {
    it('adds the autopublish switch and the SHA256SUMS choice to the fields every repository has', () => {
      expect(
        (repository.fields ?? []).map(({ name, kind }) => [name, kind]),
      ).toEqual([
        ['autopublish', 'boolean'],
        ['sha256sums', 'select'],
      ]);
    });

    it('offers the three SHA256SUMS values the server knows, with the values it expects', () => {
      const field = (repository.fields ?? []).find(
        ({ name }) => name === 'sha256sums',
      );

      expect(field?.options?.map(({ value }) => value)).toEqual([
        'disabled',
        'root',
        'directory',
      ]);
      expect(field?.options?.map(({ label }) => text(label))).toEqual([
        'Disabled',
        'One file at the root',
        'One file in every directory',
      ]);
    });

    it('starts a new repository without autopublish and without SHA256SUMS files, as the server does when told nothing', () => {
      expect(repository.createDefaults).toEqual({
        autopublish: false,
        sha256sums: 'disabled',
      });
    });
  });

  describe('the Details rows', () => {
    const row = (id: string) => {
      const found = repository.detailRows.find((each) => each.id === id);
      if (!found) {
        throw new Error(`no ${id} row`);
      }
      return found;
    };

    it('lists the retained version count, autopublish and SHA256SUMS after the rows every repository has', () => {
      expect(repository.detailRows.map(({ id }) => id)).toEqual([
        'retain-repo-versions',
        'autopublish',
        'sha256sums',
      ]);
      expect(repository.detailRows.map(({ label }) => text(label))).toEqual([
        'Retained version count',
        'Autopublish',
        'SHA256SUMS files',
      ]);
    });

    it('says All when no limit is set and the number when one is', () => {
      expect(row('retain-repo-versions').render(FILE_REPOSITORY as never)).toBe(
        'All',
      );
      expect(
        row('retain-repo-versions').render({
          ...FILE_REPOSITORY,
          retain_repo_versions: 3,
        } as never),
      ).toBe(3);
    });

    it('says Enabled or Disabled for autopublish', () => {
      expect(row('autopublish').render(FILE_REPOSITORY as never)).toBe(
        'Disabled',
      );
      expect(
        row('autopublish').render({
          ...FILE_REPOSITORY,
          autopublish: true,
        } as never),
      ).toBe('Enabled');
    });

    it('names the SHA256SUMS value the way the form offers it, and a value it does not know as it is', () => {
      const render = (sha256sums: string | undefined) =>
        row('sha256sums').render({ ...FILE_REPOSITORY, sha256sums } as never);

      expect(render('root')).toBe('One file at the root');
      expect(render('directory')).toBe('One file in every directory');
      expect(render('per-file')).toBe('per-file');
      expect(render(undefined)).toBe('Not available');
    });
  });

  describe('the repository list', () => {
    it('shows the name as a link to the repository, the labels and the created date', () => {
      expect((repository.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'labels',
        'created',
      ]);

      const [name, , created] = repository.columns ?? [];
      const link = shown(
        name?.render({ ...FILE_REPOSITORY, name: 'a/b' } as never),
      ).querySelector('a');
      expect(link).toHaveAttribute('href', '/file/repositories/a%2Fb/');
      expect(link).toHaveTextContent('a/b');
      expect(created?.sortField).toBe('pulp_created');
    });

    it('sorts only by what the server orders by', () => {
      expect(
        (repository.columns ?? []).map(({ id, sortField }) => [id, sortField]),
      ).toEqual([
        ['name', 'name'],
        ['labels', undefined],
        ['created', 'pulp_created'],
      ]);
    });

    it('names the field each column reads, so the list asks the server for it', () => {
      expect(
        (repository.columns ?? []).map(({ id, fields }) => [id, fields]),
      ).toEqual([
        ['name', ['name']],
        ['labels', ['pulp_labels']],
        ['created', ['pulp_created']],
      ]);
    });

    it('filters by name, base path, remote and labels, each by the parameter the server takes', () => {
      expect(
        (repository.filters ?? []).map(({ id, param, kind }) => [
          id,
          param,
          kind,
        ]),
      ).toEqual([
        ['name', 'name__icontains', 'text'],
        ['base-path', 'base_path', 'text'],
        ['remote', 'remote', 'remote'],
        ['labels', 'pulp_label_select', 'labels'],
      ]);
    });
  });

  describe('the sync options', () => {
    const options = repository.sync?.options ?? [];
    const option = (name: string) => {
      const found = options.find((each) => each.name === name);
      if (!found) {
        throw new Error(`no ${name} option`);
      }
      return found;
    };

    it('names the task that does the work and the field the options read', () => {
      expect(repository.sync?.taskName).toBe(
        'pulp_file.app.tasks.synchronizing.synchronize',
      );
      expect(repository.sync?.fields).toEqual(['autopublish']);
    });

    it('offers mirror and optimize as switches', () => {
      expect(options.map(({ name, kind }) => [name, kind])).toEqual([
        ['mirror', 'boolean'],
        ['optimize', 'boolean'],
      ]);
    });

    it('starts mirror off for a repository that publishes by itself, and holds it off with the reason', () => {
      const autopublishing = { ...FILE_REPOSITORY, autopublish: true };
      const mirror = option('mirror');

      expect(mirror.initial(FILE_REPOSITORY as never)).toBe(true);
      expect(mirror.initial(autopublishing as never)).toBe(false);
      expect(mirror.fixed?.(FILE_REPOSITORY as never)).toBeNull();
      expect(mirror.fixed?.(autopublishing as never)).toEqual({
        value: false,
        reason:
          'Mirroring cannot be combined with autopublish, so this sync only adds missing content.',
      });
    });

    it('starts optimize on, and never holds it', () => {
      const optimize = option('optimize');

      expect(optimize.initial(FILE_REPOSITORY as never)).toBe(true);
      expect(optimize.fixed).toBeUndefined();
    });
  });

  describe('the command snippet', () => {
    it('writes a remote create command for the manifest next to the content', () => {
      expect(
        repository.snippet?.build({
          name: 'manuals',
          url: 'https://pulp.example/content/manuals/',
        }),
      ).toBe(
        "pulp file remote create --name 'manuals' --url 'https://pulp.example/content/manuals/PULP_MANIFEST'",
      );
    });

    it('quotes a hostile name and URL as data', () => {
      expect(
        repository.snippet?.build({
          name: "a$(id)'b",
          url: 'https://pulp.example/a`id`/',
        }),
      ).toBe(
        "pulp file remote create --name 'a$(id)'\\''b' --url 'https://pulp.example/a`id`/PULP_MANIFEST'",
      );
    });
  });

  describe('the tabs', () => {
    it('adds the Versions, Publications and Distributions tabs, each at its sub-path', () => {
      expect((repository.tabs ?? []).map(({ id }) => id)).toEqual([
        'versions',
        'publications',
        'distributions',
      ]);
      expect((repository.tabs ?? []).map(({ label }) => text(label))).toEqual([
        'Versions',
        'Publications',
        'Distributions',
      ]);
    });

    it('has no packages tab, so that address is Not Found for file', () => {
      expect((repository.tabs ?? []).some(({ id }) => id === 'packages')).toBe(
        false,
      );
    });
  });

  describe('the remotes', () => {
    it('have a download policy and show it as a column and a Details row', () => {
      expect(remote?.policy).toBe(true);
      expect((remote?.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'url',
        'policy',
        'labels',
        'created',
      ]);
      expect((remote?.detailRows ?? []).map(({ id }) => id)).toEqual([
        'policy',
      ]);
    });

    it('link a remote to its own address, one segment for the name', () => {
      const [name] = remote?.columns ?? [];
      const link = shown(
        name?.render(pluginRemote('file', { name: 'a/b' }) as never),
      ).querySelector('a');

      expect(link).toHaveAttribute('href', '/file/remotes/a%2Fb/');
    });

    it('filter by name and labels', () => {
      expect(
        (remote?.filters ?? []).map(({ id, param }) => [id, param]),
      ).toEqual([
        ['name', 'name__icontains'],
        ['labels', 'pulp_label_select'],
      ]);
    });
  });

  describe('what serves and what is served', () => {
    it('reads distributions and publications, and serves from a publication', () => {
      expect(descriptor.distribution?.entity).toBeTruthy();
      expect(descriptor.publication?.entity).toBeTruthy();
      expect(descriptor.publication?.servesFromPublication).toBe(true);
    });

    it('is the descriptor of a plugin that is on the framework', () => {
      expect(
        PLUGIN_MANIFESTS.find(({ plugin }) => plugin === 'file')?.onFramework,
      ).toBe(true);
    });
  });
});
