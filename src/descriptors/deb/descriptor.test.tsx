import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { remoteFields } from 'src/framework/form/remote-fields';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { pluginRemote, pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import descriptor from './descriptor';

// The deb plugin's descriptor is what the generic screens draw its
// repositories and remotes from, so each part of it is checked here as the
// screens use it: the form fields, the Details rows, the list columns and
// filters, the options of the sync dialog, the command snippet and the tabs.

const text = (label: MessageDescriptor) => i18n._(label);

const { repository, remote } = descriptor;

// A deb repository as the server returns it, with the fields only deb has.
const DEB_REPOSITORY = {
  ...pluginRepository('deb', { name: 'bookworm-mirror' }),
  autopublish: false,
  publish_upstream_release_fields: true,
};

// A deb remote as the server returns it, with the fields only deb has.
const DEB_REMOTE = pluginRemote('deb', {
  name: 'upstream',
  distributions: 'bookworm bookworm-updates',
  components: 'main contrib',
  architectures: 'amd64 arm64',
  sync_sources: false,
  sync_udebs: false,
  sync_installer: false,
  gpgkey: null,
});

function shown(node: ReactNode): HTMLElement {
  renderWithProviders(<div data-testid='shown'>{node}</div>);
  return screen.getByTestId('shown');
}

const rowOf = (
  rows: { id: string; render: (row: never) => ReactNode }[] | undefined,
  id: string,
) => {
  const found = (rows ?? []).find((each) => each.id === id);
  if (!found) {
    throw new Error(`no ${id} row`);
  }
  return found;
};

describe('Unit: the deb descriptor', { tags: ['unit'] }, () => {
  describe('the repository form', () => {
    it('adds the autopublish and the upstream release fields switches to the fields every repository has', () => {
      expect(
        (repository.fields ?? []).map(({ name, kind }) => [name, kind]),
      ).toEqual([
        ['autopublish', 'boolean'],
        ['publish_upstream_release_fields', 'boolean'],
      ]);
      expect((repository.fields ?? []).map(({ label }) => text(label))).toEqual(
        ['Autopublish', 'Publish upstream release fields'],
      );
    });

    it('starts a new repository as the server does when told nothing: no autopublish, upstream release fields on', () => {
      expect(repository.createDefaults).toEqual({
        autopublish: false,
        publish_upstream_release_fields: true,
      });
    });
  });

  describe('the Details rows', () => {
    const row = (id: string) => rowOf(repository.detailRows, id);

    it('lists the retained version count, autopublish and the upstream release fields after the rows every repository has', () => {
      expect(repository.detailRows.map(({ id }) => id)).toEqual([
        'retain-repo-versions',
        'autopublish',
        'publish-upstream-release-fields',
      ]);
      expect(repository.detailRows.map(({ label }) => text(label))).toEqual([
        'Retained version count',
        'Autopublish',
        'Publish upstream release fields',
      ]);
    });

    it('says All when no limit is set and the number when one is', () => {
      expect(row('retain-repo-versions').render(DEB_REPOSITORY as never)).toBe(
        'All',
      );
      expect(
        row('retain-repo-versions').render({
          ...DEB_REPOSITORY,
          retain_repo_versions: 4,
        } as never),
      ).toBe(4);
    });

    it('says Enabled or Disabled for autopublish and for the upstream release fields', () => {
      expect(row('autopublish').render(DEB_REPOSITORY as never)).toBe(
        'Disabled',
      );
      expect(
        row('autopublish').render({
          ...DEB_REPOSITORY,
          autopublish: true,
        } as never),
      ).toBe('Enabled');
      expect(
        row('publish-upstream-release-fields').render(DEB_REPOSITORY as never),
      ).toBe('Enabled');
      expect(
        row('publish-upstream-release-fields').render({
          ...DEB_REPOSITORY,
          publish_upstream_release_fields: false,
        } as never),
      ).toBe('Disabled');
    });
  });

  describe('the repository list', () => {
    it('shows the name as a link to the repository, the labels and the created date', () => {
      expect((repository.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'labels',
        'created',
      ]);

      const [name] = repository.columns ?? [];
      const link = shown(
        name?.render({ ...DEB_REPOSITORY, name: 'a/b' } as never),
      ).querySelector('a');
      expect(link).toHaveAttribute('href', '/deb/repositories/a%2Fb/');
      expect(link).toHaveTextContent('a/b');
    });

    it('sorts only by what the server orders by and names what each column reads', () => {
      expect(
        (repository.columns ?? []).map(({ id, sortField, fields }) => [
          id,
          sortField,
          fields,
        ]),
      ).toEqual([
        ['name', 'name', ['name']],
        ['labels', undefined, ['pulp_labels']],
        ['created', 'pulp_created', ['pulp_created']],
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

    it('names the task that does the work', () => {
      expect(repository.sync?.taskName).toBe(
        'pulp_deb.app.tasks.synchronizing.synchronize',
      );
    });

    it('offers mirror and optimize as switches', () => {
      expect(options.map(({ name, kind }) => [name, kind])).toEqual([
        ['mirror', 'boolean'],
        ['optimize', 'boolean'],
      ]);
    });

    it('starts mirror off whatever the repository does, because a mirror sync removes content the remote no longer has', () => {
      const mirror = option('mirror');
      const publishing = { ...DEB_REPOSITORY, autopublish: true };

      expect(mirror.initial(DEB_REPOSITORY as never)).toBe(false);
      expect(mirror.initial(publishing as never)).toBe(false);
      expect(mirror.fixed).toBeUndefined();
    });

    it('starts optimize on, and never holds it', () => {
      const optimize = option('optimize');

      expect(optimize.initial(DEB_REPOSITORY as never)).toBe(true);
      expect(optimize.fixed).toBeUndefined();
    });
  });

  describe('the command snippet', () => {
    it('writes a remote create command for the distribution with the suite left to fill in, quoted', () => {
      expect(
        repository.snippet?.build({
          name: 'bookworm-mirror',
          url: 'https://pulp.example/content/bookworm/',
        }),
      ).toBe(
        "pulp deb remote create --name 'bookworm-mirror' --url 'https://pulp.example/content/bookworm/' --distributions '<suite>'",
      );
    });

    it('quotes a hostile name and URL as data', () => {
      expect(
        repository.snippet?.build({
          name: "a$(id)'b",
          url: 'https://pulp.example/a`id`/',
        }),
      ).toBe(
        "pulp deb remote create --name 'a$(id)'\\''b' --url 'https://pulp.example/a`id`/' --distributions '<suite>'",
      );
    });

    it('is the command line of the Distributions tab', () => {
      expect(text(repository.snippet?.label as MessageDescriptor)).toBe(
        'CLI configuration',
      );
    });
  });

  describe('the tabs', () => {
    it('adds the Versions and Distributions tabs, each at its sub-path, and no packages tab', () => {
      expect((repository.tabs ?? []).map(({ id }) => id)).toEqual([
        'versions',
        'distributions',
      ]);
    });
  });

  describe('the remote form', () => {
    const fields = remoteFields(descriptor, 'create');
    const field = (name: string) => {
      const found = fields.find((each) => each.name === name);
      if (!found) {
        throw new Error(`no ${name} field`);
      }
      return found;
    };

    it('has a download policy', () => {
      expect(remote?.policy).toBe(true);
      expect(field('policy').kind).toBe('select');
    });

    it('adds the apt fields after the download policy and before the credentials', () => {
      const names = fields.map(({ name }) => name);
      const own = [
        'distributions',
        'components',
        'architectures',
        'gpgkey',
        'sync_sources',
        'sync_udebs',
        'sync_installer',
      ];

      expect(
        names.slice(names.indexOf('policy') + 1, names.indexOf('username')),
      ).toEqual(own);
    });

    it('requires the distributions, which the server refuses a remote without, and nothing else of its own', () => {
      expect(field('distributions').required).toBe(true);
      expect(
        ['components', 'architectures', 'gpgkey', 'sync_sources'].map(
          (name) => field(name).required,
        ),
      ).toEqual([undefined, undefined, undefined, undefined]);
    });

    it('takes the GPG key as text or from a file, as a PEM text field, never as a secret', () => {
      expect(field('gpgkey').kind).toBe('certificate');
      expect(field('gpgkey').secret).toBeUndefined();
      expect(field('gpgkey').advanced).toBeUndefined();
    });

    it('takes the three sync choices as boxes that name what they switch on', () => {
      expect(
        ['sync_sources', 'sync_udebs', 'sync_installer'].map((name) => [
          field(name).kind,
          text(field(name).boxLabel as MessageDescriptor),
        ]),
      ).toEqual([
        ['boolean', 'Source packages will be synchronized'],
        ['boolean', 'Installer packages will be synchronized'],
        ['boolean', 'Installer files will be synchronized'],
      ]);
    });
  });

  describe('the remote list and Details', () => {
    it('shows the distributions between the URL and the download policy, sorting by name, URL and created date only', () => {
      expect(
        (remote?.columns ?? []).map(({ id, sortField }) => [id, sortField]),
      ).toEqual([
        ['name', 'name'],
        ['url', 'url'],
        ['distributions', undefined],
        ['policy', undefined],
        ['labels', undefined],
        ['created', 'pulp_created'],
      ]);
    });

    it('asks the server for the distributions the column reads, and says --- for a remote without any', () => {
      const column = (remote?.columns ?? []).find(
        ({ id }) => id === 'distributions',
      );

      expect(column?.fields).toEqual(['distributions']);
      expect(shown(column?.render(DEB_REMOTE as never))).toHaveTextContent(
        'bookworm bookworm-updates',
      );
    });

    it('shows --- for an empty distributions column', () => {
      const column = (remote?.columns ?? []).find(
        ({ id }) => id === 'distributions',
      );

      expect(
        shown(column?.render({ ...DEB_REMOTE, distributions: '' } as never)),
      ).toHaveTextContent('---');
    });

    it('lists the apt rows after the download policy in the order the old page had them', () => {
      expect((remote?.detailRows ?? []).map(({ id }) => id)).toEqual([
        'policy',
        'distributions',
        'components',
        'architectures',
        'sync-sources',
        'sync-udebs',
        'sync-installer',
        'gpgkey',
      ]);
      expect(
        (remote?.detailRows ?? []).map(({ label }) => text(label)),
      ).toEqual([
        'Download policy',
        'Distributions',
        'Components',
        'Architectures',
        'Sync sources',
        'Sync installer packages',
        'Sync installer files',
        'GPG key',
      ]);
    });

    it('says what the server holds: the suites, All for no components or architectures, Enabled or Disabled for the sync choices', () => {
      const row = (id: string) => rowOf(remote?.detailRows, id);

      expect(row('distributions').render(DEB_REMOTE as never)).toBe(
        'bookworm bookworm-updates',
      );
      expect(row('distributions').render({ distributions: '' } as never)).toBe(
        'None',
      );
      expect(row('components').render(DEB_REMOTE as never)).toBe(
        'main contrib',
      );
      expect(row('components').render({ components: null } as never)).toBe(
        'All',
      );
      expect(row('architectures').render({ architectures: '' } as never)).toBe(
        'All',
      );
      expect(row('sync-sources').render(DEB_REMOTE as never)).toBe('Disabled');
      expect(
        row('sync-udebs').render({ ...DEB_REMOTE, sync_udebs: true } as never),
      ).toBe('Enabled');
      expect(
        row('sync-installer').render({
          ...DEB_REMOTE,
          sync_installer: true,
        } as never),
      ).toBe('Enabled');
    });

    it('shows the GPG key as a code block that can be copied and downloaded under the remote name, and None without one', () => {
      const row = rowOf(remote?.detailRows, 'gpgkey');

      expect(shown(row.render(DEB_REMOTE as never))).toHaveTextContent('None');
    });

    it('shows a stored GPG key as a code block', () => {
      const row = rowOf(remote?.detailRows, 'gpgkey');
      const key = '-----BEGIN PGP PUBLIC KEY BLOCK-----\nabc';

      expect(
        shown(row.render({ ...DEB_REMOTE, gpgkey: key } as never)),
      ).toHaveTextContent('BEGIN PGP PUBLIC KEY BLOCK');
    });

    it('filters by name and labels', () => {
      expect(
        (remote?.filters ?? []).map(({ id, param }) => [id, param]),
      ).toEqual([
        ['name', 'name__icontains'],
        ['labels', 'pulp_label_select'],
      ]);
    });

    it('links a remote to its own address, one segment for the name', () => {
      const [name] = remote?.columns ?? [];
      const link = shown(
        name?.render(pluginRemote('deb', { name: 'a/b' }) as never),
      ).querySelector('a');

      expect(link).toHaveAttribute('href', '/deb/remotes/a%2Fb/');
    });
  });

  describe('what serves and what is served', () => {
    it('reads apt distributions and publications, and serves from a publication', () => {
      expect(descriptor.distribution?.entity).toBeTruthy();
      expect(descriptor.publication?.entity).toBeTruthy();
      expect(descriptor.publication?.servesFromPublication).toBe(true);
    });

    it('is the descriptor of a plugin that is on the framework, with the permissions the deb viewsets check', () => {
      const manifest = PLUGIN_MANIFESTS.find(({ plugin }) => plugin === 'deb');

      expect(manifest?.onFramework).toBe(true);
      expect(manifest?.permissions.repository.sync).toBe(
        'deb.sync_aptrepository',
      );
      expect(manifest?.permissions.remote.change).toBe('deb.change_aptremote');
    });
  });
});
