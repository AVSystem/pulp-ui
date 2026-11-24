import { i18n } from '@lingui/core';
import { msg, t } from '@lingui/core/macro';
import { DateComponent } from 'src/components';
import { fileContent } from 'src/entities/file/content';
import { fileDistribution } from 'src/entities/file/distribution';
import type { FileContent, FileRepository } from 'src/entities/file/model';
import { filePublication } from 'src/entities/file/publication';
import { fileRemote } from 'src/entities/file/remote';
import { fileRepository } from 'src/entities/file/repository';
import {
  type FieldDef,
  type PluginDescriptor,
  contentType,
} from 'src/framework/descriptor';
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
import { fileSnippets } from './snippets';

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
    tabs: [
      versionsTab<FileRepository>(),
      contentTab<FileRepository>(),
      publicationsTab<FileRepository>(),
      distributionsTab<FileRepository>(),
    ],
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
    // A file needs a path in the repository, which starts as the file's name.
    upload: { contentType: 'file.file', relativePath: 'required-default-name' },
    filters: REPOSITORY_FILTERS,
    columns: repositoryColumns<FileRepository>('file'),
  },
  remote: {
    entity: fileRemote,
    policy: true,
    columns: remoteColumns('file', { policy: true }),
    filters: REMOTE_FILTERS,
    detailRows: [POLICY_ROW],
  },
  contentTypes: [
    contentType<FileContent>({
      id: 'file.file',
      label: msg`Files`,
      pulpType: 'file.file',
      entity: fileContent,
      fields: ['relative_path', 'pulp_created', 'pulp_href'],
      columns: [
        {
          id: 'relative-path',
          label: msg`Relative path`,
          sortField: 'relative_path',
          render: ({ relative_path }) => relative_path,
        },
        {
          id: 'created',
          label: msg`Created`,
          sortField: 'pulp_created',
          render: ({ pulp_created }) =>
            pulp_created ? <DateComponent date={pulp_created} /> : t`None`,
        },
      ],
      filters: [
        { param: 'relative_path__contains', label: msg`Relative path` },
      ],
      defaultSort: 'relative_path',
      nameOf: ({ relative_path }) => relative_path,
      errorTitle: msg`Files could not be displayed.`,
      emptyTitle: msg`No files in the latest version`,
      emptyDescription: msg`Sync this repository or upload files to it.`,
    }),
  ],
  distribution: { entity: fileDistribution, snippets: fileSnippets },
  publication: {
    entity: filePublication,
    servesFromPublication: true,
    taskName: 'pulp_file.app.tasks.publishing.publish',
    columns: [
      {
        id: 'manifest',
        label: msg`Manifest`,
        render: ({ manifest }) =>
          typeof manifest === 'string' && manifest ? manifest : t`None`,
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
          return typeof sha256sums === 'string' ? sha256sums : t`None`;
        },
      },
    ],
    // Both start from the repository's own setting, which is what the server
    // uses when the request names none.
    options: [
      {
        name: 'manifest',
        label: msg`Manifest`,
        kind: 'text',
        help: msg`The name of the file that lists every published file with its checksum and size.`,
        initial: (repository) => repository.manifest || 'PULP_MANIFEST',
      },
      {
        name: 'sha256sums',
        label: msg`SHA256SUMS files`,
        kind: 'select',
        options: SHA256SUMS_OPTIONS,
        help: msg`Whether this publication includes SHA256SUMS files, which list the checksum of every published file so clients can verify a download.`,
        initial: (repository) => repository.sha256sums || 'disabled',
      },
    ],
  },
};

export default descriptor;
