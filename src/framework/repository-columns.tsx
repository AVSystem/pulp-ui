import { msg } from '@lingui/core/macro';
import { Link } from 'react-router';
import { DateComponent } from 'src/components';
import type { RepositoryBase } from 'src/entities/plugin/model';
import type { ColumnDef, FilterDef } from './descriptor';
import { LabelChips } from './labels/label-chips';
import type { FrameworkPlugin } from './manifest';
import { repositoryPath } from './route-patterns';

// What every plugin's repository list shows and filters by, so a plugin's
// descriptor takes these and adds only what is its own.

// The columns of a repository list: the name (linked to the repository), the
// labels and the created date. Only the name and the created date sort, because
// the server orders by those.
export function repositoryColumns<Row extends RepositoryBase>(
  plugin: FrameworkPlugin,
): ColumnDef<Row>[] {
  return [
    {
      id: 'name',
      label: msg`Repository name`,
      sortField: 'name',
      fields: ['name'],
      render: (repository) => (
        <Link to={repositoryPath(plugin, repository.name)}>
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
  ];
}

// The filters of a repository list: the name, the base path of a distribution
// that serves it, the remote it syncs from and its labels.
export const REPOSITORY_FILTERS: FilterDef[] = [
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
];
