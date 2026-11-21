import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Link } from 'react-router';
import { CopyURL, DateComponent } from 'src/components';
import type { RemoteBase } from 'src/entities/plugin/model';
import type { ColumnDef, DetailRow, FilterDef } from './descriptor';
import { LabelChips } from './labels/label-chips';
import type { FrameworkPlugin } from './manifest';
import { remotePath } from './route-patterns';

// What every plugin's remote list shows and filters by, so a plugin's
// descriptor composes its remote columns from these and adds only what is its
// own.

// When the content a remote offers is downloaded. The values are the server's.
export const POLICY_OPTIONS = [
  { value: 'immediate', label: msg`Immediate` },
  { value: 'on_demand', label: msg`On demand` },
  { value: 'streamed', label: msg`Streamed` },
];

// The policy as a person reads it; a value the server may add later is shown
// as it came.
export function policyText(policy: string | null | undefined): string {
  const known = POLICY_OPTIONS.find(({ value }) => value === policy);

  if (known) {
    return i18n._(known.label);
  }
  return policy || '---';
}

// The Download policy row of a remote's details, for a plugin whose remotes
// have a policy.
export const POLICY_ROW: DetailRow<RemoteBase> = {
  id: 'policy',
  label: msg`Download policy`,
  render: ({ policy }) => policyText(policy),
};

interface Options {
  // Whether the plugin's remotes have a download policy.
  policy?: boolean;
}

// The columns of a remote list: the name (linked to the remote), the URL it
// syncs from, the download policy where the plugin has one, the labels and the
// created date. Only the name, the URL and the created date sort, because the
// server orders by those.
export function remoteColumns(
  plugin: FrameworkPlugin,
  { policy = false }: Options = {},
): ColumnDef<RemoteBase>[] {
  return [
    {
      id: 'name',
      label: msg`Remote name`,
      sortField: 'name',
      fields: ['name'],
      render: (remote) => (
        <Link to={remotePath(plugin, remote.name)}>{remote.name}</Link>
      ),
    },
    {
      id: 'url',
      label: msg`URL`,
      sortField: 'url',
      fields: ['url'],
      render: (remote) => <CopyURL url={remote.url ?? ''} fallback />,
    },
    ...(policy
      ? [
          {
            id: 'policy',
            label: msg`Download policy`,
            fields: ['policy'],
            render: (remote: RemoteBase) => policyText(remote.policy),
          },
        ]
      : []),
    {
      id: 'labels',
      label: msg`Labels`,
      fields: ['pulp_labels'],
      render: (remote) => <LabelChips labels={remote.pulp_labels} />,
    },
    {
      id: 'created',
      label: msg`Created date`,
      sortField: 'pulp_created',
      sortKind: 'numeric',
      fields: ['pulp_created'],
      render: (remote) => <DateComponent date={remote.pulp_created ?? ''} />,
    },
  ];
}

// The filters of a remote list: the name and the labels.
export const REMOTE_FILTERS: FilterDef[] = [
  {
    id: 'name',
    label: msg`Remote name`,
    param: 'name__icontains',
    kind: 'text',
  },
  {
    id: 'labels',
    label: msg`Labels`,
    param: 'pulp_label_select',
    kind: 'labels',
  },
];
