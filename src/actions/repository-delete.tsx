import { msg, t } from '@lingui/core/macro';
import { DeleteRepositoryModal } from '../components/delete-repository-modal';
import { ACTION_PERMISSIONS } from '../utilities/action-permissions';
import { deleteRepositoryWithDistributions } from '../utilities/delete-repository';
import { plugin2api } from '../utilities/plugin-repository-base-path';
import { type RepositoryDistributionPlugin } from '../utilities/repository-distributions';
import { Action } from './action';

// Runs a page update that cannot be reported anywhere if it fails.
const attempt = (update: () => void) => {
  try {
    update();
  } catch {
    // the repository is already gone: there is nothing left to roll back
  }
};

// The Delete action of a plugin's repositories: removes every distribution
// that serves the repository, then the repository, after the user typed its
// name. It is offered to whoever holds the plugin's delete permission, on the
// repository or on every repository.
export const repositoryDeleteAction = (
  plugin: RepositoryDistributionPlugin,
) => {
  const { RepositoryAPI, DistributionAPI } = plugin2api(plugin);

  return Action({
    title: msg`Delete`,
    permission: ACTION_PERMISSIONS[plugin].repository.delete,
    objectLevel: ACTION_PERMISSIONS[plugin].objectRoles,
    modal: ({ addAlert, isMounted, listQuery, queueAlert, setState, state }) =>
      state.deleteModalOpen ? (
        <DeleteRepositoryModal
          key={state.deleteModalOpen.pulp_href}
          closeAction={() => setState({ deleteModalOpen: null })}
          deleteAction={async (shown) => {
            const { name, pulp_href } = state.deleteModalOpen;
            // Rejects only with DeleteNotStarted: from here on the dialog
            // reads a rejection as "nothing was deleted".
            const result = await deleteRepositoryWithDistributions({
              plugin,
              RepositoryAPI,
              DistributionAPI,
              repository: { name, pulp_href },
              shown,
            });

            if (result.repositoryDeleted) {
              // A delete can outlive the page it started from. A page that is
              // gone cannot show the result, and reloading or leaving it would
              // pull the user away from wherever they are now, so the result
              // is queued for the next screen instead. A context that cannot
              // tell counts as a page that is still there.
              const pageGone = isMounted ? !isMounted() : false;
              const report = pageGone && queueAlert ? queueAlert : addAlert;
              // The repository is gone. A failure of one of the page updates
              // below must neither reach the dialog as a failed delete nor
              // keep the other updates from running.
              attempt(() =>
                report({
                  variant: 'success',
                  title: t`Removed repository ${name}`,
                  description: result.removed.length
                    ? t`Removed distributions: ${result.removed.join(', ')}`
                    : undefined,
                }),
              );
              // The run may outlive the dialog it started from (the page was
              // left and another repository's dialog opened since), so only
              // the dialog of this repository is closed.
              attempt(() =>
                setState((current) =>
                  current?.deleteModalOpen?.pulp_href === pulp_href
                    ? { deleteModalOpen: null }
                    : null,
                ),
              );
              if (!pageGone) {
                attempt(listQuery);
              }
            }

            return result;
          }}
          name={state.deleteModalOpen.name}
          plugin={plugin}
          pulpHref={state.deleteModalOpen.pulp_href}
        />
      ) : null,
    onClick: (
      { name, pulp_href }: { name: string; pulp_href?: string },
      { setState },
    ) => setState({ deleteModalOpen: { name, pulp_href } }),
  });
};
