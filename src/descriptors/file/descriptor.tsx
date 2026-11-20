import { msg, t } from '@lingui/core/macro';
import { Link } from 'react-router';
import { DateComponent } from 'src/components';
import { fileDistribution } from 'src/entities/file/distribution';
import type { FileRepository } from 'src/entities/file/model';
import { filePublication } from 'src/entities/file/publication';
import { fileRemote } from 'src/entities/file/remote';
import { fileRepository } from 'src/entities/file/repository';
import type { PluginDescriptor } from 'src/framework/descriptor';
import { distributionsTab } from 'src/framework/detail/distributions-tab';
import { LabelChips } from 'src/framework/labels/label-chips';
import { repositoryPath } from 'src/framework/route-patterns';
import { shellQuote } from 'src/utilities/shell-quote';

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
    ],
    tabs: [distributionsTab<FileRepository>()],
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
  remote: { entity: fileRemote },
  distribution: { entity: fileDistribution },
  publication: { entity: filePublication, servesFromPublication: true },
};

export default descriptor;
