import { type MessageDescriptor, i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { rpmDistribution } from 'src/entities/rpm/distribution';
import type { RpmPackage, RpmRepository } from 'src/entities/rpm/model';
import { rpmPackage } from 'src/entities/rpm/package';
import { rpmPublication } from 'src/entities/rpm/publication';
import { rpmRemote } from 'src/entities/rpm/remote';
import { rpmRepository } from 'src/entities/rpm/repository';
import { type PluginDescriptor, contentType } from 'src/framework/descriptor';
import { contentTab } from 'src/framework/detail/content-tab';
import { distributionsTab } from 'src/framework/detail/distributions-tab';
import { publicationsTab } from 'src/framework/detail/publications-tab';
import { versionsTab } from 'src/framework/detail/versions-tab';
import {
  POLICY_ROW,
  REMOTE_FILTERS,
  remoteColumns,
} from 'src/framework/remote-columns';
import {
  REPOSITORY_FILTERS,
  repositoryColumns,
} from 'src/framework/repository-columns';
import { rpmSnippets } from './snippets';

// epoch:version-release, with the epoch left out when it is 0, as rpm and dnf
// show it. The server sends the epoch as text, and a number is taken too.
const evr = ({ epoch, version, release }: RpmPackage): string => {
  const prefix = epoch != null && String(epoch) !== '0' ? `${epoch}:` : '';

  return `${prefix}${version}${release ? `-${release}` : ''}`;
};

// What the server does about content a remote no longer has. Additive is the
// server's own default and never removes content: mirroring is opted into,
// never defaulted to. The values are the server's.
const SYNC_POLICIES = [
  { value: 'additive', label: msg`Additive: only add new content` },
  { value: 'mirror_content_only', label: msg`Mirror content only` },
  {
    value: 'mirror_complete',
    label: msg`Mirror complete (exact copy incl. metadata)`,
  },
];

// The choice that leaves the type to the server, which takes the repository's
// own setting, or its own default when the repository sets none.
const FROM_REPOSITORY = {
  value: '',
  label: msg`The repository's setting or the server's default`,
};

// The checksums a publication can use for the metadata it generates, and the
// compressions it can apply to that metadata. The values are the server's.
const CHECKSUM_TYPES = [
  FROM_REPOSITORY,
  { value: 'md5', label: msg`md5` },
  { value: 'sha1', label: msg`sha1` },
  { value: 'sha224', label: msg`sha224` },
  { value: 'sha256', label: msg`sha256` },
  { value: 'sha384', label: msg`sha384` },
  { value: 'sha512', label: msg`sha512` },
];
const COMPRESSION_TYPES = [
  FROM_REPOSITORY,
  { value: 'zstd', label: msg`zstd` },
  { value: 'gz', label: msg`gzip` },
  { value: 'none', label: msg`No compression` },
];

// The label of the option that holds a value the server answered with, or the
// value itself when it is not one the form offers.
function optionLabel(
  options: { value: string; label: MessageDescriptor }[],
  value: unknown,
): string {
  if (typeof value !== 'string' || value === '') {
    return t`None`;
  }
  const option = options.find((candidate) => candidate.value === value);

  return option ? i18n._(option.label) : value;
}

// The rpm plugin's repositories and remotes as the framework reads them. The
// descriptor and what it imports are one chunk that loads when an rpm screen is
// first shown.
const descriptor: PluginDescriptor<RpmRepository> = {
  repository: {
    entity: rpmRepository,
    detailRows: [
      {
        id: 'retain-repo-versions',
        label: msg`Retained version count`,
        render: (repository) => repository.retain_repo_versions ?? t`All`,
      },
      {
        id: 'autopublish',
        label: msg`Autopublish`,
        render: (repository) =>
          repository.autopublish ? t`Enabled` : t`Disabled`,
      },
      {
        id: 'retain-package-versions',
        label: msg`Retained package versions`,
        // 0 is how the server says that every version of a package is kept
        render: (repository) => repository.retain_package_versions || t`All`,
      },
    ],
    fields: [
      {
        name: 'retain_package_versions',
        label: msg`Versions kept per package`,
        kind: 'integer',
        // The server has no null for it: 0 keeps every version, so a blank
        // field is sent as 0.
        blankValue: 0,
        help: msg`How many versions of each package to keep; older ones are dropped on sync. Leave blank to keep all versions.`,
      },
      {
        name: 'autopublish',
        label: msg`Autopublish`,
        kind: 'boolean',
        boxLabel: msg`Publish new versions automatically`,
        help: msg`Create a publication for every new repository version, so distributions pointing at this repository always serve the latest content.`,
      },
    ],
    // A new repository does not publish by itself, which is what the server
    // does when it is told nothing.
    createDefaults: { autopublish: false },
    tabs: [
      versionsTab<RpmRepository>(),
      contentTab<RpmRepository>(),
      publicationsTab<RpmRepository>(),
      distributionsTab<RpmRepository>(),
    ],
    sync: {
      taskName: 'pulp_rpm.app.tasks.synchronizing.synchronize',
      options: [
        {
          name: 'sync_policy',
          label: msg`Sync policy`,
          kind: 'select',
          options: SYNC_POLICIES,
          help: msg`Additive keeps everything already in the repository. Mirror content only removes what the remote no longer has. Mirror complete also reproduces the remote's metadata exactly, which kickstart trees need.`,
          initial: () => 'additive',
        },
        {
          name: 'optimize',
          label: msg`Optimize`,
          kind: 'boolean',
          boxLabel: msg`Only perform the sync if changes are reported by the remote server.`,
          help: msg`Only perform the sync if changes are reported by the remote server. To force a sync to happen, deselect this option.`,
          initial: () => true,
        },
      ],
    },
    // A package needs no path from the user: the server names it from the package.
    upload: { contentType: 'rpm.package', relativePath: 'none' },
    filters: REPOSITORY_FILTERS,
    columns: repositoryColumns<RpmRepository>('rpm'),
  },
  remote: {
    entity: rpmRemote,
    policy: true,
    columns: remoteColumns('rpm', { policy: true }),
    filters: REMOTE_FILTERS,
    detailRows: [POLICY_ROW],
  },
  // The packages of a repository: the Content tab and the version pages list
  // them. The server orders by the name; the version is not ordered on its own,
  // because a version is compared by epoch, version and release together.
  contentTypes: [
    contentType<RpmPackage>({
      id: 'rpm.package',
      label: msg`Packages`,
      pulpType: 'rpm.package',
      entity: rpmPackage,
      fields: [
        'name',
        'epoch',
        'version',
        'release',
        'arch',
        'summary',
        'pulp_href',
      ],
      columns: [
        {
          id: 'name',
          label: msg`Name`,
          sortField: 'name',
          render: ({ name }) => name,
        },
        { id: 'version', label: msg`Version`, render: evr },
        { id: 'arch', label: msg`Arch`, render: ({ arch }) => arch },
        {
          id: 'summary',
          label: msg`Summary`,
          render: ({ summary }) => summary,
        },
      ],
      filters: [
        { param: 'name__contains', label: msg`Package name` },
        { param: 'arch', label: msg`Arch` },
      ],
      defaultSort: 'name',
      nameOf: (row) => `${row.name}-${evr(row)}.${row.arch}`,
      errorTitle: msg`Packages could not be displayed.`,
      emptyTitle: msg`No packages in the latest version`,
      emptyDescription: msg`Sync this repository or add packages to it.`,
    }),
  ],
  distribution: { entity: rpmDistribution, snippets: rpmSnippets },
  publication: {
    entity: rpmPublication,
    servesFromPublication: true,
    taskName: 'pulp_rpm.app.tasks.publishing.publish',
    columns: [
      {
        id: 'checksum_type',
        label: msg`Checksum type`,
        render: ({ checksum_type }) =>
          optionLabel(CHECKSUM_TYPES, checksum_type),
      },
      {
        id: 'compression_type',
        label: msg`Compression type`,
        render: ({ compression_type }) =>
          optionLabel(COMPRESSION_TYPES, compression_type),
      },
    ],
    options: [
      {
        name: 'checksum_type',
        label: msg`Checksum type`,
        kind: 'select',
        options: CHECKSUM_TYPES,
        help: msg`The checksum type used in the metadata of this publication.`,
        initial: (repository) => repository.checksum_type ?? '',
      },
      {
        name: 'compression_type',
        label: msg`Compression type`,
        kind: 'select',
        options: COMPRESSION_TYPES,
        help: msg`How the metadata files of this publication are compressed.`,
        initial: (repository) => repository.compression_type ?? '',
      },
    ],
  },
};

export default descriptor;
