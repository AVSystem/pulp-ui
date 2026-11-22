import { msg } from '@lingui/core/macro';
import {
  type FieldDef,
  type PluginDescriptor,
  repositoryOf,
} from '../descriptor';

// The name of a repository in the form; it is shown on an edit and never sent.
export const NAME_FIELD = 'name';

// The fields of a repository's form: the ones every repository has, the ones
// the plugin adds, then the labels and the remote the repository syncs from. A
// plugin without a remote list has no remote field.
export function repositoryFields(descriptor: PluginDescriptor): FieldDef[] {
  const { fields = [] } = repositoryOf(descriptor);

  return [
    { name: NAME_FIELD, label: msg`Name`, kind: 'text', required: true },
    { name: 'description', label: msg`Description`, kind: 'text' },
    {
      name: 'retain_repo_versions',
      label: msg`Retained number of versions`,
      kind: 'integer',
      help: msg`In order to retain all versions, leave this field blank.`,
    },
    ...fields,
    {
      name: 'pulp_labels',
      label: msg`Labels`,
      kind: 'labels',
      help: msg`Labels are pairs of a key and an optional value. Filters and scripts use them to find repositories.`,
    },
    ...(descriptor.remote
      ? [
          {
            name: 'remote',
            label: msg`Remote`,
            kind: 'remote' as const,
            help: msg`Setting a remote allows a repository to sync from elsewhere.`,
          },
        ]
      : []),
  ];
}
