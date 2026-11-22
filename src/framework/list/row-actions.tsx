import { t } from '@lingui/core/macro';
import { DropdownItem } from '@patternfly/react-core';
import type { ReactElement } from 'react';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import type { FrameworkPlugin, IPluginPermissions } from '../manifest';
import { repositoryEditPath } from '../route-patterns';

// The actions a list offers on a row. An action does not know the plugin it is
// shown for: it names the permission it needs by its key in the plugin's
// manifest (`change`, `sync`, `delete` and so on) and the list resolves that
// to the permission name of the plugin and decides, from what it is told the
// user holds, whether to offer it. An action that cannot be confirmed is
// absent, never disabled; Pulp decides every request, so hiding an action is
// presentation only.

// A permission of a repository's actions, by its key in the manifest.
export type RepositoryPermission = keyof IPluginPermissions['repository'];

export interface RowActionContext {
  plugin: FrameworkPlugin;
  navigate: (to: string) => void;
  // Opens the dialog that deletes the row's repository with the distributions
  // that serve it.
  requestDelete: (row: RepositoryBase) => void;
  // Opens the dialog that syncs the row's repository.
  requestSync: (row: RepositoryBase) => void;
}

export interface RowAction<Row> {
  // Unique among the actions of a list.
  id: string;
  // The permission the action needs, by its key in the manifest.
  permission: RepositoryPermission;
  // Whether the action makes sense for this row at all, apart from the user's
  // permission: the plugin may not have the thing (a sync) or the row lack what
  // it needs (a remote). An action that applies to every row declares none.
  appliesTo?: (row: Row, descriptor: PluginDescriptor) => boolean;
  // The menu item of the action for one row, called while the list renders.
  item: (row: Row, context: RowActionContext) => ReactElement;
}

// The actions every list of repositories has. Screens that add an action to
// the list (sync, delete, labels) put it here.
export const REPOSITORY_ROW_ACTIONS: RowAction<RepositoryBase>[] = [
  {
    id: 'sync',
    permission: 'sync',
    // A repository with no remote has nothing to sync from.
    appliesTo: (row, descriptor) =>
      repositoryOf(descriptor).sync !== undefined && !!row.remote,
    item: (row, { requestSync }) => (
      <DropdownItem key='sync' onClick={() => requestSync(row)}>
        {t`Sync`}
      </DropdownItem>
    ),
  },
  {
    id: 'edit',
    permission: 'change',
    item: (row, { plugin, navigate }) => (
      <DropdownItem
        key='edit'
        onClick={() => navigate(repositoryEditPath(plugin, row.name))}
      >
        {t`Edit`}
      </DropdownItem>
    ),
  },
  {
    id: 'delete',
    permission: 'delete',
    item: (row, { requestDelete }) => (
      <DropdownItem key='delete' onClick={() => requestDelete(row)}>
        {t`Delete`}
      </DropdownItem>
    ),
  },
];

// The actions offered for a row: those that apply to it and whose permission
// the user may be confirmed to hold on it.
export function actionsFor<Row>(
  actions: readonly RowAction<Row>[],
  row: Row,
  permits: (permission: RepositoryPermission, row: Row) => boolean,
  descriptor: PluginDescriptor,
): RowAction<Row>[] {
  return actions.filter(
    (action) =>
      (action.appliesTo?.(row, descriptor) ?? true) &&
      permits(action.permission, row),
  );
}
