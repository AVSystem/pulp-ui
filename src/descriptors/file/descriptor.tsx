import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { Link } from 'react-router';
import { DateComponent } from 'src/components';
import { fileDistribution } from 'src/entities/file/distribution';
import type { FileRepository } from 'src/entities/file/model';
import { filePublication } from 'src/entities/file/publication';
import { fileRemote } from 'src/entities/file/remote';
import { fileRepository } from 'src/entities/file/repository';
import type { FieldDef, PluginDescriptor } from 'src/framework/descriptor';
import { distributionsTab } from 'src/framework/detail/distributions-tab';
import { versionsTab } from 'src/framework/detail/versions-tab';
import { LabelChips } from 'src/framework/labels/label-chips';
import {
  POLICY_ROW,
  REMOTE_FILTERS,
  remoteColumns,
} from 'src/framework/remote-columns';
import { repositoryPath } from 'src/framework/route-patterns';
import { shellQuote } from 'src/utilities/shell-quote';

// What a publication of a file repository does about SHA256SUMS files, which
// list the checksum of every published file. The values are the server's.
const SHA256SUMS_OPTIONS: NonNullable<FieldDef['options']> = [
  { value: 'disabled', label: msg`Disabled` },
  { value: 'root', label: msg`One file at the root` },
  { value: 'directory', label: msg`One file in every directory` },
];

// The file plugin's repositories and remotes as the framework reads them. The
// descriptor and what it imports are one chunk that loads when a file screen is
// first shown.
const descriptor: PluginDescriptor<FileRepository> = {
  repository: {
    entity: fileRepository,
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
        id: 'sha256sums',
        label: msg`SHA256SUMS files`,
        render: ({ sha256sums }) => {
          const option = SHA256SUMS_OPTIONS.find(
            ({ value }) => value === sha256sums,
          );

          if (option) {
            return i18n._(option.label);
          }
          return sha256sums ?? t`Not available`;
        },
      },
    ],
    fields: [
      {
        name: 'autopublish',
        label: msg`Autopublish`,
        kind: 'boolean',
        boxLabel: msg`Publish new versions automatically`,
        help: msg`Create a publication for every new repository version, so distributions pointing at this repository always serve the latest content.`,
      },
      {
        name: 'sha256sums',
        label: msg`SHA256SUMS files`,
        kind: 'select',
        options: SHA256SUMS_OPTIONS,
        help: msg`Whether the publications of this repository include SHA256SUMS files, which list the checksum of every published file so clients can verify a download.`,
      },
    ],
    // A new repository does not publish by itself and writes no SHA256SUMS
    // files, which is what the server does when it is told nothing.
    createDefaults: { autopublish: false, sha256sums: 'disabled' },
    tabs: [versionsTab<FileRepository>(), distributionsTab<FileRepository>()],
    sync: {
      taskName: 'pulp_file.app.tasks.synchronizing.synchronize',
      fields: ['autopublish'],
      options: [
        {
          name: 'mirror',
          label: msg`Mirror`,
          kind: 'boolean',
          boxLabel: msg`Content not present in remote repository will be removed from the local repository`,
          help: msg`If selected, all content that is not present in the remote repository will be removed from the local repository; otherwise, sync will add missing content.`,
          // A repository that publishes by itself is refused a mirror sync, so
          // it starts off and cannot be turned on.
          initial: (repository) => !repository.autopublish,
          fixed: (repository) =>
            repository.autopublish
              ? {
                  value: false,
                  reason: t`Mirroring cannot be combined with autopublish, so this sync only adds missing content.`,
                }
              : null,
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
    // The manifest sits next to the content, at the distribution's URL. The
    // command is pasted into a terminal, so the name and the URL are quoted as
    // shell words: a repository name is free text.
    snippet: {
      label: msg`CLI configuration`,
      build: ({ name, url }) =>
        `pulp file remote create --name ${shellQuote(name)} --url ${shellQuote(`${url}PULP_MANIFEST`)}`,
    },
    filters: [
      {
        id: 'name',
        label: msg`Repository name`,
        param: 'name__icontains',
        kind: 'text',
      },
      {
        id: 'base-path',
        label: msg`Base path`,
        param: 'base_path',
        kind: 'text',
      },
      {
        id: 'remote',
        label: msg`Remote`,
        param: 'remote',
        kind: 'remote',
      },
      {
        id: 'labels',
        label: msg`Labels`,
        param: 'pulp_label_select',
        kind: 'labels',
      },
    ],
    columns: [
      {
        id: 'name',
        label: msg`Repository name`,
        sortField: 'name',
        fields: ['name'],
        render: (repository) => (
          <Link to={repositoryPath('file', repository.name)}>
            {repository.name}
          </Link>
        ),
      },
      {
        id: 'labels',
        label: msg`Labels`,
        fields: ['pulp_labels'],
        render: (repository) => <LabelChips labels={repository.pulp_labels} />,
      },
      {
        id: 'created',
        label: msg`Created date`,
        sortField: 'pulp_created',
        sortKind: 'numeric',
        fields: ['pulp_created'],
        render: (repository) => (
          <DateComponent date={repository.pulp_created ?? ''} />
        ),
      },
    ],
  },
  remote: {
    entity: fileRemote,
    policy: true,
    columns: remoteColumns('file', { policy: true }),
    filters: REMOTE_FILTERS,
    detailRows: [POLICY_ROW],
  },
  distribution: { entity: fileDistribution },
  publication: { entity: filePublication, servesFromPublication: true },
};

export default descriptor;
