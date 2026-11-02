import { msg, t } from '@lingui/core/macro';
import { DeleteRepositoryModal } from '../components/delete-repository-modal';
import { deleteRepositoryWithDistributions } from '../utilities/delete-repository';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import { plugin2api } from '../utilities/plugin-repository-base-path';
import { type RepositoryDistributionPlugin } from '../utilities/repository-distributions';
import { Action } from './action';

// The Delete action of a plugin's repositories: removes every distribution
// that serves the repository, then the repository, after the user typed its
// name.
export const repositoryDeleteAction = (
  plugin: RepositoryDistributionPlugin,
) => {
  const { RepositoryAPI, DistributionAPI } = plugin2api(plugin);

  return Action({
    title: msg`Delete`,
    modal: ({ addAlert, listQuery, setState, state }) =>
      state.deleteModalOpen ? (
        <DeleteRepositoryModal
          key={state.deleteModalOpen.pulp_href}
          closeAction={() => setState({ deleteModalOpen: null })}
          deleteAction={async () => {
            const { name, pulp_href } = state.deleteModalOpen;
            const result = await deleteRepositoryWithDistributions({
              plugin,
              RepositoryAPI,
              DistributionAPI,
              repository: { name, pulp_href },
            });

            if (result.repositoryDeleted) {
              addAlert({
                variant: 'success',
                title: t`Removed repository ${name}`,
                description: result.removed.length
                  ? t`Removed distributions: ${result.removed.join(', ')}`
                  : undefined,
              });
              // The run may outlive the dialog it started from (the page was
              // left and another repository's dialog opened since), so only
              // the dialog of this repository is closed.
              setState((current) =>
                current?.deleteModalOpen?.pulp_href === pulp_href
                  ? { deleteModalOpen: null }
                  : null,
              );
              listQuery();
            }

            return result;
          }}
          name={state.deleteModalOpen.name}
          plugin={plugin}
          pulpHref={state.deleteModalOpen.pulp_href}
        />
      ) : null,
    onClick: (
      {
        name,
        id,
        pulp_href,
      }: { name: string; id?: string; pulp_href?: string },
      { setState },
    ) =>
      setState({
        deleteModalOpen: {
          pulpId: id || parsePulpIDFromURL(pulp_href),
          name,
          pulp_href,
        },
      }),
  });
};
