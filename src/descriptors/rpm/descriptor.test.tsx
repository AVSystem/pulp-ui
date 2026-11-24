import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  toCreateBody,
  toForm,
  toRequest,
} from 'src/framework/form/form-values';
import { remoteFields } from 'src/framework/form/remote-fields';
import { repositoryFields } from 'src/framework/form/repository-fields';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { pluginRemote, pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import descriptor from './descriptor';

// The rpm plugin's descriptor is what the generic screens draw its
// repositories and remotes from, so each part of it is checked here as the
// screens use it: the form fields, the Details rows, the list columns and
// filters, the options of the sync dialog, the command snippet and the tabs.

const text = (label: MessageDescriptor) => i18n._(label);

const { repository, remote } = descriptor;

// An rpm repository as the server returns it, with the fields only rpm has.
const RPM_REPOSITORY = {
  ...pluginRepository('rpm', { name: 'baseos' }),
  autopublish: false,
  retain_package_versions: 0,
};

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

describe('Unit: the rpm descriptor', { tags: ['unit'] }, () => {
  describe('the repository form', () => {
    it('adds the versions kept per package and the autopublish box, in that order, after the retained number of versions', () => {
      expect(
        (repository.fields ?? []).map(({ name, kind }) => [name, kind]),
      ).toEqual([
        ['retain_package_versions', 'integer'],
        ['autopublish', 'boolean'],
      ]);
      expect((repository.fields ?? []).map(({ label }) => text(label))).toEqual(
        ['Versions kept per package', 'Autopublish'],
      );
      const names = repositoryFields(descriptor).map(({ name }) => name);
      expect(names.slice(names.indexOf('retain_repo_versions'))).toEqual([
        'retain_repo_versions',
        'retain_package_versions',
        'autopublish',
        'pulp_labels',
        'remote',
      ]);
    });

    it('starts a new repository as the server does when told nothing: no autopublish', () => {
      expect(repository.createDefaults).toEqual({ autopublish: false });
    });

    it('sends 0 for a blank versions-per-package field and the number typed otherwise, because the server has no null for it', () => {
      const fields = repositoryFields(descriptor);
      const blank = toForm(fields, { name: 'a', retain_package_versions: 0 });

      expect(blank.retain_package_versions).toBe('');
      expect(
        toRequest(fields, blank, ['retain_package_versions']),
      ).toStrictEqual({ retain_package_versions: 0 });
      expect(
        toRequest(fields, { ...blank, retain_package_versions: ' 3 ' }, [
          'retain_package_versions',
        ]),
      ).toStrictEqual({ retain_package_versions: 3 });
      expect(
        toCreateBody(fields, { ...blank, retain_package_versions: '' }),
      ).toMatchObject({
        retain_package_versions: 0,
        retain_repo_versions: null,
      });
    });
  });

  describe('the Details rows', () => {
    const row = (id: string) => rowOf(repository.detailRows, id);

    it('lists the retained version count, autopublish and the retained package versions after the rows every repository has', () => {
      expect(repository.detailRows.map(({ id }) => id)).toEqual([
        'retain-repo-versions',
        'autopublish',
        'retain-package-versions',
      ]);
      expect(repository.detailRows.map(({ label }) => text(label))).toEqual([
        'Retained version count',
        'Autopublish',
        'Retained package versions',
      ]);
    });

    it('says All when no limit is set and the number when one is', () => {
      expect(row('retain-repo-versions').render(RPM_REPOSITORY as never)).toBe(
        'All',
      );
      expect(
        row('retain-repo-versions').render({
          ...RPM_REPOSITORY,
          retain_repo_versions: 4,
        } as never),
      ).toBe(4);
    });

    it('says All for no package limit, whether the server holds 0 or nothing, and the number otherwise', () => {
      expect(
        row('retain-package-versions').render(RPM_REPOSITORY as never),
      ).toBe('All');
      expect(
        row('retain-package-versions').render({
          ...RPM_REPOSITORY,
          retain_package_versions: null,
        } as never),
      ).toBe('All');
      expect(
        row('retain-package-versions').render({
          ...RPM_REPOSITORY,
          retain_package_versions: 2,
        } as never),
      ).toBe(2);
    });

    it('says Enabled or Disabled for autopublish', () => {
      expect(row('autopublish').render(RPM_REPOSITORY as never)).toBe(
        'Disabled',
      );
      expect(
        row('autopublish').render({
          ...RPM_REPOSITORY,
          autopublish: true,
        } as never),
      ).toBe('Enabled');
    });
  });

  describe('the repository list', () => {
    it('shows the name as a link to the repository, the labels and the created date, as every plugin does', () => {
      expect((repository.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'labels',
        'created',
      ]);

      const [name] = repository.columns ?? [];
      const link = shown(
        name?.render({ ...RPM_REPOSITORY, name: 'a/b' } as never),
      ).querySelector('a');
      expect(link).toHaveAttribute('href', '/rpm/repositories/a%2Fb/');
      expect(link).toHaveTextContent('a/b');
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
        'pulp_rpm.app.tasks.synchronizing.synchronize',
      );
    });

    it('offers a sync policy choice and the optimize switch, and no mirror switch', () => {
      expect(options.map(({ name, kind }) => [name, kind])).toEqual([
        ['sync_policy', 'select'],
        ['optimize', 'boolean'],
      ]);
    });

    it('offers the three policies the server knows, additive first', () => {
      expect(
        (option('sync_policy').options ?? []).map(({ value, label }) => [
          value,
          text(label),
        ]),
      ).toEqual([
        ['additive', 'Additive: only add new content'],
        ['mirror_content_only', 'Mirror content only'],
        ['mirror_complete', 'Mirror complete (exact copy incl. metadata)'],
      ]);
    });

    it('starts on additive for every repository, because a mirror policy removes content the remote no longer has, and never holds the choice', () => {
      const policy = option('sync_policy');
      const publishing = { ...RPM_REPOSITORY, autopublish: true };

      expect(policy.initial(RPM_REPOSITORY as never)).toBe('additive');
      expect(policy.initial(publishing as never)).toBe('additive');
      expect(policy.fixed).toBeUndefined();
    });

    it('explains the three policies where the choice is made', () => {
      expect(text(option('sync_policy').help as MessageDescriptor)).toMatch(
        /Additive keeps everything.*Mirror content only.*Mirror complete/,
      );
    });

    it('starts optimize on, and never holds it', () => {
      const optimize = option('optimize');

      expect(optimize.initial(RPM_REPOSITORY as never)).toBe(true);
      expect(optimize.fixed).toBeUndefined();
    });
  });

  describe('the command snippet', () => {
    it('writes a remote create command for the distribution, quoted', () => {
      expect(
        repository.snippet?.build({
          name: 'baseos',
          url: 'https://pulp.example/content/baseos/',
        }),
      ).toBe(
        "pulp rpm remote create --name 'baseos' --url 'https://pulp.example/content/baseos/'",
      );
    });

    it('quotes a hostile name and URL as data', () => {
      expect(
        repository.snippet?.build({
          name: "a$(id)'b",
          url: 'https://pulp.example/a`id`/',
        }),
      ).toBe(
        "pulp rpm remote create --name 'a$(id)'\\''b' --url 'https://pulp.example/a`id`/'",
      );
    });

    it('is the command line of the Distributions tab', () => {
      expect(text(repository.snippet?.label as MessageDescriptor)).toBe(
        'CLI configuration',
      );
    });
  });

  describe('the tabs and the content', () => {
    it('adds the Versions, Publications, Distributions and Packages tabs, each at its sub-path', () => {
      expect((repository.tabs ?? []).map(({ id }) => id)).toEqual([
        'versions',
        'publications',
        'distributions',
        'packages',
      ]);
      expect((repository.tabs ?? []).map(({ label }) => text(label))).toEqual([
        'Versions',
        'Publications',
        'Distributions',
        'Packages',
      ]);
    });

    it('declares the packages as the content type of its repositories', () => {
      expect(
        (descriptor.contentTypes ?? []).map(({ id, label }) => [
          id,
          text(label),
        ]),
      ).toEqual([['rpm.package', 'Packages']]);
    });

    it('names the type the server gives its packages and lists name, version, arch and summary', () => {
      const [type] = descriptor.contentTypes ?? [];

      expect(type.pulpType).toBe('rpm.package');
      expect(type.columns.map(({ label }) => text(label))).toEqual([
        'Name',
        'Version',
        'Arch',
        'Summary',
      ]);
    });
  });

  describe('the remote form', () => {
    const fields = remoteFields(descriptor, 'create');

    it('has a download policy and adds no field of its own', () => {
      expect(remote?.policy).toBe(true);
      expect(remote?.fields).toBeUndefined();
      expect(fields.find(({ name }) => name === 'policy')?.kind).toBe('select');
    });
  });

  describe('the remote list and Details', () => {
    it('shows the name, the URL, the download policy, the labels and the created date', () => {
      expect((remote?.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'url',
        'policy',
        'labels',
        'created',
      ]);
      expect(
        (remote?.columns ?? []).map(({ id, sortField }) => [id, sortField]),
      ).toEqual([
        ['name', 'name'],
        ['url', 'url'],
        ['policy', undefined],
        ['labels', undefined],
        ['created', 'pulp_created'],
      ]);
    });

    it('lists the download policy among the rows and says it as a person reads it', () => {
      expect((remote?.detailRows ?? []).map(({ id }) => id)).toEqual([
        'policy',
      ]);
      expect(
        rowOf(remote?.detailRows, 'policy').render(
          pluginRemote('rpm', { policy: 'on_demand' }) as never,
        ),
      ).toBe('On demand');
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
        name?.render(pluginRemote('rpm', { name: 'a/b' }) as never),
      ).querySelector('a');

      expect(link).toHaveAttribute('href', '/rpm/remotes/a%2Fb/');
    });
  });

  describe('what serves and what is served', () => {
    it('reads rpm distributions and publications, and serves from a publication', () => {
      expect(descriptor.distribution?.entity).toBeTruthy();
      expect(descriptor.publication?.entity).toBeTruthy();
      expect(descriptor.publication?.servesFromPublication).toBe(true);
    });

    it('is the descriptor of a plugin that is on the framework, with the permissions the rpm viewsets check and object roles as the permission table has them', () => {
      const manifest = PLUGIN_MANIFESTS.find(({ plugin }) => plugin === 'rpm');

      expect(manifest?.onFramework).toBe(true);
      expect(manifest?.permissions.objectRoles).toBe(true);
      expect(manifest?.permissions.repository.sync).toBe(
        'rpm.sync_rpmrepository',
      );
      expect(manifest?.permissions.remote.change).toBe('rpm.change_rpmremote');
    });
  });
});
