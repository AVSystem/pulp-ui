import { t } from '@lingui/core/macro';
import { AlertActionLink } from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, type AlertType, Spinner } from 'src/components';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import type { DistributionIndex } from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { entityKeys } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import type { RepositoryPermission } from '../list/row-actions';
import { bulkDelete } from './bulk-actions';
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
import { SyncBulkDialog } from './sync-bulk-dialog';

// The bulk actions of a list of repositories: the menu in the toolbar, and the
// dialog of the one the user chose for the rows they selected.

export type RepositoryBulkId = 'delete' | 'sync' | 'add-label' | 'remove-label';

// What the list asks for to decide who may do what: the permission keys the
// actions need.
export const BULK_REPOSITORY_PERMISSIONS: RepositoryPermission[] = [
  'delete',
  'sync',
  'change',
];

type RepositoryPermits = Permits<RepositoryPermission, RepositoryBase>;

const ACTIONS = (
  descriptor: PluginDescriptor,
): BulkMenuAction<RepositoryPermission>[] => [
  ...(repositoryOf(descriptor).sync
    ? [{ id: 'sync', permission: 'sync' as const, label: t`Sync` }]
    : []),
  { id: 'add-label', permission: 'change', label: t`Add label` },
  { id: 'remove-label', permission: 'change', label: t`Remove label` },
  { id: 'delete', permission: 'delete', label: t`Delete` },
];

// The actions the user may take on at least one of the rows.
export function repositoryBulkActions(
  descriptor: PluginDescriptor,
  rows: readonly RepositoryBase[],
  permits: RepositoryPermits,
): BulkMenuAction<RepositoryPermission>[] {
  return offeredActions(ACTIONS(descriptor), rows, permits);
}

interface Props {
  descriptor: PluginDescriptor;
  // The selected rows, in the order of the page.
  selected: readonly RepositoryBase[];
  // The actions the toolbar offers.
  actions: readonly BulkMenuAction<RepositoryPermission>[];
  permits: RepositoryPermits;
  // What serves each repository, as the list reads it.
  index: DistributionIndex<DistributionBase>;
  // Called once a run has ended, while the list is still shown.
  onFinished: (alert: AlertType) => void;
}

interface Chosen {
  id: string;
  rows: RepositoryBase[];
  notPermitted: string[];
}

export const RepositoryBulk = ({
  descriptor,
  selected,
  actions,
  permits,
  index,
  onFinished,
}: Props) => {
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const close = () => setChosen(null);

  const choose = (action: BulkMenuAction<RepositoryPermission>) => {
    const { allowed, refused } = splitByPermission(
      selected,
      action.permission,
      permits,
    );
    setChosen({ id: action.id, rows: allowed, notPermitted: refused });
  };

  const common = chosen
    ? {
        rows: chosen.rows,
        notPermitted: chosen.notPermitted,
        onClose: close,
        onFinished,
      }
    : null;

  return (
    <>
      <BulkToolbar
        actions={actions}
        count={selected.length}
        onChoose={choose}
      />
      {chosen && common ? (
        chosen.id === 'delete' ? (
          <DeleteBulkDialog descriptor={descriptor} index={index} {...common} />
        ) : chosen.id === 'sync' ? (
          <SyncBulkDialog descriptor={descriptor} {...common} />
        ) : (
          <LabelBulkDialog
            mode={chosen.id === 'add-label' ? 'add' : 'remove'}
            entity={repositoryOf(descriptor).entity}
            {...common}
          />
        )
      ) : null}
    </>
  );
};

interface DeleteProps {
  descriptor: PluginDescriptor;
  index: DistributionIndex<DistributionBase>;
  rows: readonly RepositoryBase[];
  notPermitted: readonly string[];
  onClose: () => void;
  onFinished: (alert: AlertType) => void;
}

// Confirms the removal of the selected repositories and of the distributions
// that serve them, listed from the index the list already holds, and runs the
// deletes four at a time. The delete is offered once that index is complete,
// so nobody confirms without seeing what goes with each repository.
const DeleteBulkDialog = ({
  descriptor,
  index,
  rows,
  notPermitted,
  onClose,
  onFinished,
}: DeleteProps) => {
  const queryClient = useQueryClient();
  const ready = index.status === 'success';
  const { distributionsOfRepository } = index;

  // What the dialog shows for each repository, and what the delete is held to.
  const shown = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.pulp_href,
          distributionsOfRepository(row.pulp_href) ?? [],
        ]),
      ),
    [rows, distributionsOfRepository],
  );
  const listed = useMemo(
    () =>
      rows.map(({ pulp_href, name }) => {
        const serving = shown.get(pulp_href) ?? [];
        return {
          pulp_href,
          name,
          note: serving.length
            ? t`Distributions deleted with it: ${serving
                .map((row) =>
                  row.content_guard
                    ? t`${row.name} (protected by a content guard)`
                    : row.name,
                )
                .join(', ')}`
            : undefined,
        };
      }),
    [rows, shown],
  );

  const run = (onSettled: OnSettled) =>
    bulkDelete(
      {
        rows,
        repository: repositoryOf(descriptor).entity,
        distribution: descriptor.distribution?.entity,
        publication: descriptor.publication,
        shownFor: ({ pulp_href }) =>
          shown.get(pulp_href)?.map(({ name, pulp_href: href }) => ({
            name,
            pulp_href: href,
          })) ?? [],
      },
      onSettled,
    );

  // What was read of the plugin's objects is stale as soon as anything was
  // sent.
  const reread = () => {
    void queryClient.invalidateQueries({
      queryKey: entityKeys(repositoryOf(descriptor).entity).all,
    });
    if (descriptor.distribution) {
      void queryClient.invalidateQueries({
        queryKey: entityKeys(descriptor.distribution.entity).all,
      });
    }
  };

  return (
    <BulkDialog
      title={t`Delete selected repositories?`}
      lead={t`The selected repositories are deleted together with the distributions that serve them, and the URLs of those distributions stop working.`}
      confirmLabel={t`Delete`}
      isDanger
      rows={listed}
      notPermitted={notPermitted}
      canStart={ready}
      options={
        ready ? null : index.status === 'error' ? (
          <Alert
            isInline
            variant='danger'
            title={t`The distributions could not be listed, so nothing can be deleted.`}
            actionLinks={
              <AlertActionLink
                onClick={index.retry}
              >{t`Retry`}</AlertActionLink>
            }
          >
            {isSessionEnd(index.error)
              ? null
              : requestErrorDescription(index.error)}
          </Alert>
        ) : (
          <Spinner size='md' aria-label={t`Loading distributions`} />
        )
      }
      run={run}
      afterRun={reread}
      alertTitle={() => t`Deleting the selected repositories finished`}
      onClose={onClose}
      onFinished={onFinished}
    />
  );
};
