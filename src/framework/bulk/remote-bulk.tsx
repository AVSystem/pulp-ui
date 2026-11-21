import { t } from '@lingui/core/macro';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import type { AlertType } from 'src/components';
import type { RemoteBase } from 'src/entities/plugin/model';
import { entityKeys } from 'src/entities/plugin/queries';
import type { PluginDescriptor } from '../descriptor';
import type { RemotePermission } from '../list/remote-row-actions';
import type { UsingRepository } from '../list/used-by';
import { useWatchTask } from '../watched-tasks';
import { bulkDeleteRemotes, watchLimiter } from './bulk-actions';
import type { OnSettled } from './bulk-actions';
import { BulkDialog } from './bulk-dialog';
import {
  type BulkMenuAction,
  BulkToolbar,
  type Permits,
  offeredActions,
  splitByPermission,
} from './bulk-menu';
import { LabelBulkDialog } from './label-bulk-dialog';

// The bulk actions of a list of remotes: delete and the two label changes. A
// remote has nothing to sync.

// What the list asks for to decide who may do what: the permission keys the
// actions need.
export const BULK_REMOTE_PERMISSIONS: RemotePermission[] = ['delete', 'change'];

type RemotePermits = Permits<RemotePermission, RemoteBase>;

const ACTIONS = (): BulkMenuAction<RemotePermission>[] => [
  { id: 'add-label', permission: 'change', label: t`Add label` },
  { id: 'remove-label', permission: 'change', label: t`Remove label` },
  { id: 'delete', permission: 'delete', label: t`Delete` },
];

// The actions the user may take on at least one of the rows.
export function remoteBulkActions(
  rows: readonly RemoteBase[],
  permits: RemotePermits,
): BulkMenuAction<RemotePermission>[] {
  return offeredActions(ACTIONS(), rows, permits);
}

// How many repositories are named in the note of a remote about to go.
const NAMED_USERS = 5;

interface Props {
  descriptor: PluginDescriptor;
  selected: readonly RemoteBase[];
  actions: readonly BulkMenuAction<RemotePermission>[];
  permits: RemotePermits;
  // The repositories that use a remote, from the read the list shares.
  usedBy: (remote: string) => readonly UsingRepository[];
  onFinished: (alert: AlertType) => void;
}

interface Chosen {
  id: string;
  rows: RemoteBase[];
  notPermitted: string[];
}

export const RemoteBulk = ({
  descriptor,
  selected,
  actions,
  permits,
  usedBy,
  onFinished,
}: Props) => {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const close = () => setChosen(null);
  const { remote } = descriptor;

  const choose = (action: BulkMenuAction<RemotePermission>) => {
    const { allowed, refused } = splitByPermission(
      selected,
      action.permission,
      permits,
    );
    setChosen({ id: action.id, rows: allowed, notPermitted: refused });
  };

  if (!remote) {
    return null;
  }

  return (
    <>
      <BulkToolbar
        actions={actions}
        count={selected.length}
        onChoose={choose}
      />
      {chosen ? (
        chosen.id === 'delete' ? (
          <DeleteBulkDialog
            descriptor={descriptor}
            usedBy={usedBy}
            rows={chosen.rows}
            notPermitted={chosen.notPermitted}
            onClose={close}
            onFinished={onFinished}
          />
        ) : (
          <LabelBulkDialog
            mode={chosen.id === 'add-label' ? 'add' : 'remove'}
            entity={remote.entity}
            rows={chosen.rows}
            notPermitted={chosen.notPermitted}
            onClose={close}
            onFinished={onFinished}
          />
        )
      ) : null}
    </>
  );
};

interface DeleteProps {
  descriptor: PluginDescriptor;
  usedBy: (remote: string) => readonly UsingRepository[];
  rows: readonly RemoteBase[];
  notPermitted: readonly string[];
  onClose: () => void;
  onFinished: (alert: AlertType) => void;
}

// Confirms the delete of the selected remotes, naming the repositories that use
// each, and sends one delete per remote, four at a time. The repositories are
// kept; they are left without a remote. Each delete is a task: the table links
// it and the first ones are followed by the application.
const DeleteBulkDialog = ({
  descriptor,
  usedBy,
  rows,
  notPermitted,
  onClose,
  onFinished,
}: DeleteProps) => {
  const queryClient = useQueryClient();
  const { watch } = useWatchTask();
  const entity = (descriptor.remote as NonNullable<PluginDescriptor['remote']>)
    .entity;

  const listed = useMemo(
    () =>
      rows.map(({ pulp_href, name }) => {
        const users = usedBy(pulp_href);
        const shown = users.slice(0, NAMED_USERS).map((user) => user.name);
        const more = users.length - shown.length;
        const names = shown.join(', ');
        return {
          pulp_href,
          name,
          note:
            users.length === 0
              ? undefined
              : more > 0
                ? t`Used by ${names} and ${more} more`
                : t`Used by ${names}`,
        };
      }),
    [rows, usedBy],
  );

  const run = (onSettled: OnSettled) => {
    const follow = watchLimiter();

    return bulkDeleteRemotes(
      entity,
      rows,
      (row, task) => {
        if (follow()) {
          const { name } = row;
          watch({
            href: task,
            label: t`Removal of remote ${name}`,
            resource: {
              app: entity.app,
              object: entity.object,
              href: row.pulp_href,
            },
          });
        }
      },
      onSettled,
    );
  };

  return (
    <BulkDialog
      title={t`Delete selected remotes?`}
      lead={t`The selected remotes are deleted. The repositories that use them are kept and are left without a remote.`}
      confirmLabel={t`Delete`}
      isDanger
      rows={listed}
      notPermitted={notPermitted}
      run={run}
      afterRun={() =>
        void queryClient.invalidateQueries({ queryKey: entityKeys(entity).all })
      }
      alertTitle={() => t`Deleting the selected remotes was started`}
      onClose={onClose}
      onFinished={onFinished}
    />
  );
};
