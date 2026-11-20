import { msg, t } from '@lingui/core/macro';
import type { FileRepository } from 'src/entities/file/model';
import { fileRepository } from 'src/entities/file/repository';
import type { PluginDescriptor } from 'src/framework/descriptor';
import { LabelChips } from 'src/framework/labels/label-chips';

// The file plugin's repositories and remotes as the framework reads them. The
// descriptor and what it imports are one chunk that loads when a file screen is
// first shown.
const descriptor: PluginDescriptor<FileRepository> = {
  repository: {
    entity: fileRepository,
    detailRows: [
      {
        id: 'name',
        label: msg`Repository name`,
        render: (repository) => repository.name,
      },
      {
        id: 'description',
        label: msg`Description`,
        render: (repository) => repository.description || t`None`,
      },
      {
        id: 'retain-repo-versions',
        label: msg`Retained version count`,
        render: (repository) => repository.retain_repo_versions ?? t`All`,
      },
      {
        id: 'labels',
        label: msg`Labels`,
        render: (repository) => <LabelChips labels={repository.pulp_labels} />,
      },
    ],
  },
};

export default descriptor;
