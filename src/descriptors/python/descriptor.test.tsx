import { i18n } from '@lingui/core';
import type { MessageDescriptor } from '@lingui/core';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  toCreateBody,
  toFilledBody,
  toForm,
  toRequest,
} from 'src/framework/form/form-values';
import { remoteFields } from 'src/framework/form/remote-fields';
import { repositoryFields } from 'src/framework/form/repository-fields';
import { PLUGIN_MANIFESTS } from 'src/framework/manifest';
import { pluginRemote, pluginRepository } from 'src/test-utils/pulp';
import { renderWithProviders } from 'src/test-utils/render';
import descriptor from './descriptor';

// The python plugin's descriptor is what the generic screens draw its
// repositories and remotes from, so each part of it is checked here as the
// screens use it: the form fields, the Details rows, the list columns and
// filters, the options of the sync dialog, the command snippet and the tabs.

const text = (label: MessageDescriptor) => i18n._(label);

const { repository, remote } = descriptor;

// A python repository as the server returns it, with the fields only python
// has.
const PYTHON_REPOSITORY = {
  ...pluginRepository('python', { name: 'simple' }),
  allow_package_substitution: true,
  error_on_reject: true,
};

// A python remote as the server returns it.
const PYTHON_REMOTE = pluginRemote('python', {
  name: 'pypi',
  url: 'https://pypi.example/',
  policy: 'on_demand',
  includes: [],
  excludes: [],
  prereleases: false,
  package_types: [],
  keep_latest_packages: 0,
  exclude_platforms: [],
  provenance: false,
  vulnerabilities: false,
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

describe('Unit: the python descriptor', { tags: ['unit'] }, () => {
  describe('the repository form', () => {
    it('adds the two package rules, after the retained number of versions', () => {
      expect(
        (repository.fields ?? []).map(({ name, kind }) => [name, kind]),
      ).toEqual([
        ['allow_package_substitution', 'boolean'],
        ['error_on_reject', 'boolean'],
      ]);
      expect((repository.fields ?? []).map(({ label }) => text(label))).toEqual(
        ['Allow package substitution', 'Fail on rejected packages'],
      );
      const names = repositoryFields(descriptor).map(({ name }) => name);
      expect(names.slice(names.indexOf('retain_repo_versions'))).toEqual([
        'retain_repo_versions',
        'allow_package_substitution',
        'error_on_reject',
        'pulp_labels',
        'remote',
      ]);
    });

    it('starts a new repository as the server does when told nothing: substitution allowed and a rejected package failing the version', () => {
      expect(repository.createDefaults).toEqual({
        allow_package_substitution: true,
        error_on_reject: true,
      });
    });

    it('has no autopublish box, because the server has deprecated the field', () => {
      expect(
        (repository.fields ?? []).some(({ name }) => name === 'autopublish'),
      ).toBe(false);
    });

    it('sends the two boxes as they are ticked on a create and on an edit', () => {
      const fields = repositoryFields(descriptor);
      const values = toForm(fields, {
        name: 'a',
        allow_package_substitution: true,
        error_on_reject: true,
      });

      expect(toCreateBody(fields, values)).toMatchObject({
        allow_package_substitution: true,
        error_on_reject: true,
      });
      expect(
        toRequest(fields, { ...values, error_on_reject: false }, [
          'error_on_reject',
        ]),
      ).toStrictEqual({ error_on_reject: false });
    });
  });

  describe('the Details rows', () => {
    const row = (id: string) => rowOf(repository.detailRows, id);

    it('lists the retained version count, the package substitution and the rejection rule after the rows every repository has', () => {
      expect(repository.detailRows.map(({ id }) => id)).toEqual([
        'retain-repo-versions',
        'allow-package-substitution',
        'error-on-reject',
      ]);
      expect(repository.detailRows.map(({ label }) => text(label))).toEqual([
        'Retained version count',
        'Package substitution',
        'When packages are rejected',
      ]);
    });

    it('says All when no limit is set and the number when one is', () => {
      expect(
        row('retain-repo-versions').render(PYTHON_REPOSITORY as never),
      ).toBe('All');
      expect(
        row('retain-repo-versions').render({
          ...PYTHON_REPOSITORY,
          retain_repo_versions: 4,
        } as never),
      ).toBe(4);
    });

    it('says whether a package may replace one of the same file name', () => {
      expect(
        row('allow-package-substitution').render(PYTHON_REPOSITORY as never),
      ).toBe('Allowed');
      expect(
        row('allow-package-substitution').render({
          ...PYTHON_REPOSITORY,
          allow_package_substitution: false,
        } as never),
      ).toBe('Not allowed');
    });

    it('says what happens to a package that is rejected', () => {
      expect(row('error-on-reject').render(PYTHON_REPOSITORY as never)).toBe(
        'Fail the whole version',
      );
      expect(
        row('error-on-reject').render({
          ...PYTHON_REPOSITORY,
          error_on_reject: false,
        } as never),
      ).toBe('Skip them');
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
        name?.render({ ...PYTHON_REPOSITORY, name: 'a/b' } as never),
      ).querySelector('a');
      expect(link).toHaveAttribute('href', '/python/repositories/a%2Fb/');
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
      expect(repository.sync?.taskName).toBe('pulp_python.app.tasks.sync.sync');
    });

    it('offers the mirror switch and no optimize option, because the python sync has none', () => {
      expect(options.map(({ name, kind }) => [name, kind])).toEqual([
        ['mirror', 'boolean'],
      ]);
    });

    it('starts the mirror switch off for every repository and never holds it, because a mirror sync removes content the remote no longer has', () => {
      const mirror = option('mirror');

      expect(mirror.initial(PYTHON_REPOSITORY as never)).toBe(false);
      expect(
        mirror.initial({ ...PYTHON_REPOSITORY, autopublish: true } as never),
      ).toBe(false);
      expect(mirror.fixed).toBeUndefined();
    });
  });

  describe('the command snippet', () => {
    it('writes the pip command for the distribution, with its simple index as one quoted word and the package left to fill in', () => {
      expect(
        repository.snippet?.build({
          name: 'simple',
          url: 'https://pulp.example/pypi/simple/',
        }),
      ).toBe(
        "pip install --index-url 'https://pulp.example/pypi/simple/simple/' <package>",
      );
    });

    it('adds the slash the server leaves off a distribution address', () => {
      expect(
        repository.snippet?.build({
          name: 'simple',
          url: 'https://pulp.example/pypi/x',
        }),
      ).toBe(
        "pip install --index-url 'https://pulp.example/pypi/x/simple/' <package>",
      );
    });

    it('quotes a hostile address as data', () => {
      expect(
        repository.snippet?.build({
          name: 'simple',
          url: "https://pulp.example/a'b`id`/",
        }),
      ).toBe(
        "pip install --index-url 'https://pulp.example/a'\\''b`id`/simple/' <package>",
      );
    });

    it('is the Install with pip column of the Distributions tab', () => {
      expect(text(repository.snippet?.label as MessageDescriptor)).toBe(
        'Install with pip',
      );
    });
  });

  describe('the tabs', () => {
    it('adds the Versions and Distributions tabs, each at its sub-path', () => {
      expect((repository.tabs ?? []).map(({ id }) => id)).toEqual([
        'versions',
        'distributions',
      ]);
      expect((repository.tabs ?? []).map(({ label }) => text(label))).toEqual([
        'Versions',
        'Distributions',
      ]);
    });
  });

  describe('the remote form', () => {
    const fields = remoteFields(descriptor, 'create');
    const own = remote?.fields ?? [];

    it('has a download policy and adds the python fields after it, in the order of the old form, then the 3.124 scan', () => {
      expect(remote?.policy).toBe(true);
      expect(own.map(({ name, kind }) => [name, kind])).toEqual([
        ['includes', 'lines'],
        ['excludes', 'lines'],
        ['prereleases', 'boolean'],
        ['package_types', 'choices'],
        ['keep_latest_packages', 'integer'],
        ['exclude_platforms', 'choices'],
        ['provenance', 'boolean'],
        ['vulnerabilities', 'boolean'],
      ]);
      const names = fields.map(({ name }) => name);
      expect(names.indexOf('policy')).toBeLessThan(names.indexOf('includes'));
      expect(names.indexOf('vulnerabilities')).toBeLessThan(
        names.indexOf('username'),
      );
    });

    it('offers the eight package types and the four platforms the server knows', () => {
      const optionsOf = (name: string) =>
        (own.find((field) => field.name === name)?.options ?? []).map(
          ({ value }) => value,
        );

      expect(optionsOf('package_types')).toEqual([
        'sdist',
        'bdist_wheel',
        'bdist_egg',
        'bdist_dumb',
        'bdist_rpm',
        'bdist_msi',
        'bdist_wininst',
        'bdist_dmg',
      ]);
      expect(optionsOf('exclude_platforms')).toEqual([
        'windows',
        'macos',
        'freebsd',
        'linux',
      ]);
    });

    it('splits includes and excludes at the lines, trims them and drops blanks, so one specifier is one item', () => {
      const values = toForm(fields, {
        name: 'pypi',
        url: 'https://pypi.example/',
      });

      expect(
        toRequest(
          fields,
          {
            ...values,
            includes: 'django>=4.2\n  requests \n\n',
            excludes: '\n django<4\n',
          },
          ['includes', 'excludes'],
        ),
      ).toStrictEqual({
        includes: ['django>=4.2', 'requests'],
        excludes: ['django<4'],
      });
    });

    it('shows the stored includes one to a line, and a stored latest-versions 0 as blank', () => {
      const values = toForm(fields, {
        ...PYTHON_REMOTE,
        includes: ['django>=4.2', 'requests'],
        keep_latest_packages: 0,
      });

      expect(values.includes).toBe('django>=4.2\nrequests');
      expect(values.keep_latest_packages).toBe('');
    });

    it('sends 0 for a blank latest-versions field and the number typed otherwise, because the server has no null for it', () => {
      const values = toForm(fields, {
        ...PYTHON_REMOTE,
        keep_latest_packages: 0,
      });

      expect(toRequest(fields, values, ['keep_latest_packages'])).toStrictEqual(
        { keep_latest_packages: 0 },
      );
      expect(
        toRequest(fields, { ...values, keep_latest_packages: ' 3 ' }, [
          'keep_latest_packages',
        ]),
      ).toStrictEqual({ keep_latest_packages: 3 });
    });

    it('sends the boxes as ticked, the scan included, and leaves the lists and the sets out of a create that left them empty', () => {
      const values = toForm(fields, {
        name: 'pypi',
        url: 'https://pypi.example/',
        policy: 'on_demand',
      });
      const body = toFilledBody(fields, {
        ...values,
        vulnerabilities: true,
        prereleases: true,
      });

      expect(body).toMatchObject({
        prereleases: true,
        provenance: false,
        vulnerabilities: true,
        keep_latest_packages: 0,
      });
      for (const left of [
        'includes',
        'excludes',
        'package_types',
        'exclude_platforms',
      ]) {
        expect(body, left).not.toHaveProperty(left);
      }
    });
  });

  describe('the remote list and Details', () => {
    const row = (id: string) => rowOf(remote?.detailRows, id);

    it('shows the name, the URL, the download policy, the labels and the created date', () => {
      expect((remote?.columns ?? []).map(({ id }) => id)).toEqual([
        'name',
        'url',
        'policy',
        'labels',
        'created',
      ]);
    });

    it('lists the policy and the python rows in the order of the old page', () => {
      expect((remote?.detailRows ?? []).map(({ id }) => id)).toEqual([
        'policy',
        'includes',
        'excludes',
        'prereleases',
        'package-types',
        'keep-latest-packages',
        'exclude-platforms',
        'provenance',
        'vulnerabilities',
      ]);
      expect(
        (remote?.detailRows ?? []).map(({ label }) => text(label)),
      ).toEqual([
        'Download policy',
        'Includes',
        'Excludes',
        'Pre-releases',
        'Package types',
        'Latest versions kept per package',
        'Excluded platforms',
        'Provenance',
        'Vulnerability scan',
      ]);
    });

    it('says what a remote syncs: all projects when nothing is included, none excluded, and the lists joined by commas', () => {
      expect(row('includes').render(PYTHON_REMOTE as never)).toBe(
        'All projects',
      );
      expect(
        row('includes').render({
          ...PYTHON_REMOTE,
          includes: ['django', 'requests'],
        } as never),
      ).toBe('django, requests');
      expect(row('excludes').render(PYTHON_REMOTE as never)).toBe('None');
      expect(
        row('excludes').render({
          ...PYTHON_REMOTE,
          excludes: ['django<4'],
        } as never),
      ).toBe('django<4');
    });

    it('says whether pre-releases, provenance and the vulnerability scan are on', () => {
      expect(row('prereleases').render(PYTHON_REMOTE as never)).toBe(
        'Excluded',
      );
      expect(
        row('prereleases').render({
          ...PYTHON_REMOTE,
          prereleases: true,
        } as never),
      ).toBe('Included');
      expect(row('provenance').render(PYTHON_REMOTE as never)).toBe(
        'Not synced',
      );
      expect(
        row('provenance').render({
          ...PYTHON_REMOTE,
          provenance: true,
        } as never),
      ).toBe('Synced');
      expect(row('vulnerabilities').render(PYTHON_REMOTE as never)).toBe(
        'Disabled',
      );
      expect(
        row('vulnerabilities').render({
          ...PYTHON_REMOTE,
          vulnerabilities: true,
        } as never),
      ).toBe('Enabled');
    });

    it('says All for no package type and no limit, and None for no excluded platform', () => {
      expect(row('package-types').render(PYTHON_REMOTE as never)).toBe('All');
      expect(
        row('package-types').render({
          ...PYTHON_REMOTE,
          package_types: ['sdist', 'bdist_wheel'],
        } as never),
      ).toBe('sdist, bdist_wheel');
      expect(row('keep-latest-packages').render(PYTHON_REMOTE as never)).toBe(
        'All',
      );
      expect(
        row('keep-latest-packages').render({
          ...PYTHON_REMOTE,
          keep_latest_packages: 2,
        } as never),
      ).toBe(2);
      expect(row('exclude-platforms').render(PYTHON_REMOTE as never)).toBe(
        'None',
      );
      expect(
        row('exclude-platforms').render({
          ...PYTHON_REMOTE,
          exclude_platforms: ['windows', 'macos'],
        } as never),
      ).toBe('windows, macos');
    });

    it('links a remote to its own address, one segment for the name', () => {
      const [name] = remote?.columns ?? [];
      const link = shown(
        name?.render(pluginRemote('python', { name: 'a/b' }) as never),
      ).querySelector('a');

      expect(link).toHaveAttribute('href', '/python/remotes/a%2Fb/');
    });
  });

  describe('what serves and what is served', () => {
    it('reads python distributions and declares no publication, because a python distribution is served without one', () => {
      expect(descriptor.distribution?.entity).toBeTruthy();
      expect(descriptor.publication).toBeUndefined();
    });

    it('is the descriptor of a plugin that is on the framework, with the permissions the python viewsets check and object roles as the manifest has them', () => {
      const manifest = PLUGIN_MANIFESTS.find(
        ({ plugin }) => plugin === 'python',
      );

      expect(manifest?.onFramework).toBe(true);
      expect(manifest?.permissions.objectRoles).toBe(true);
      expect(manifest?.permissions.repository.sync).toBe(
        'python.sync_pythonrepository',
      );
      expect(manifest?.permissions.remote.change).toBe(
        'python.change_pythonremote',
      );
    });
  });
});
