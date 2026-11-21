import { t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import type { ReactElement } from 'react';
import type { RemoteBase } from 'src/entities/plugin/model';
import type { FrameworkPlugin, IPluginPermissions } from '../manifest';
import { remoteEditPath } from '../route-patterns';

// The actions a list of remotes offers on a row. As for repositories, an action
// names the permission it needs by its key in the plugin's manifest and the
// list decides, from what it is told the user holds, whether to offer it. An
// action that cannot be confirmed is absent, never disabled; Pulp decides
// every request, so hiding an action is presentation only.

// A permission of a remote's actions, by its key in the manifest.
export type RemotePermission = keyof IPluginPermissions['remote'];

export interface RemoteActionContext {
  plugin: FrameworkPlugin;
  navigate: (to: string) => void;
}

export interface RemoteRowAction {
  // Unique among the actions of a list.
  id: string;
  // The permission the action needs, by its key in the manifest.
  permission: RemotePermission;
  // The menu item of the action for one row, called while the list renders.
  item: (row: RemoteBase, context: RemoteActionContext) => ReactElement;
}

export const REMOTE_ROW_ACTIONS: RemoteRowAction[] = [
  {
    id: 'edit',
    permission: 'change',
    item: (row, { plugin, navigate }) => (
      <DropdownItem
        key='edit'
        onClick={() => navigate(remoteEditPath(plugin, row.name))}
      >
        {t`Edit`}
      </DropdownItem>
    ),
  },
];
