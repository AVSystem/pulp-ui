import { msg, t } from '@lingui/core/macro';
import { PythonDistributionAPI } from 'src/api/python-distribution';
import {
  PythonRepositoryAPI,
  type PythonRepositoryType,
} from 'src/api/python-repository';
import { Page, RepositoryForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import {
  createAlerts,
  createRepository,
  saveErrorMessages,
} from 'src/utilities/create-repository';
import { patchRepository } from 'src/utilities/update-repository';

// retain_repo_versions null keeps every version of a new repository
const initialRepository: PythonRepositoryType = {
  name: '',
  description: '',
  retain_repo_versions: null,
  pulp_labels: {},
  remote: null,
};

const PythonRepositoryEdit = Page<PythonRepositoryType>({
  breadcrumbs: ({ name }) =>
    [
      { url: formatPath(Paths.python.repository.list), name: t`Repositories` },
      name && {
        url: formatPath(Paths.python.repository.detail, { name }),
        name,
      },
      name ? { name: t`Edit` } : { name: t`Add` },
    ].filter(Boolean),

  displayName: 'PythonRepositoryEdit',
  errorTitle: msg`Repository could not be displayed.`,
  listUrl: formatPath(Paths.python.repository.list),
  query: ({ name }) =>
    PythonRepositoryAPI.list({ name }).then(
      ({ data: { results } }) => results[0],
    ),
  title: ({ name }) => name || t`Add new repository`,
  transformParams: ({ name, ...rest }) => ({
    ...rest,
    name: name !== '_' ? name : null,
  }),

  render: (item, { navigate, queueAlert, state, setState }) => {
    // derived while rendering; the edited copy is stored on the first change
    const repositoryToEdit = state.repositoryToEdit ?? {
      ...initialRepository,
      ...item,
    };
    const errorMessages = state.errorMessages ?? {};

    const saveRepository = async ({ distribution }) => {
      setState({ errorMessages: {} });

      const data = { ...repositoryToEdit };

      // prevent "This field may not be blank." for nullable fields
      Object.keys(data).forEach((k) => {
        if (data[k] === '') {
          data[k] = null;
        }
      });

      data.pulp_labels ||= {};

      const goToRepository = () => {
        setState({ errorMessages: {}, repositoryToEdit: undefined });
        navigate(
          formatPath(Paths.python.repository.detail, { name: data.name }),
        );
      };

      try {
        if (item) {
          // editing never creates a distribution
          queueAlert(
            await patchRepository({
              RepositoryAPI: PythonRepositoryAPI,
              item,
              edited: data,
            }),
          );
          goToRepository();
          return;
        }

        const result = await createRepository({
          RepositoryAPI: PythonRepositoryAPI,
          DistributionAPI: PythonDistributionAPI,
          data,
          distribution,
        });

        createAlerts(data.name, distribution, result).forEach(queueAlert);
        goToRepository();
      } catch (e) {
        setState({ errorMessages: saveErrorMessages(e) });
      }
    };

    const closeModal = () => {
      setState({ errorMessages: {}, repositoryToEdit: undefined });
      navigate(
        item
          ? formatPath(Paths.python.repository.detail, {
              name: item.name,
            })
          : formatPath(Paths.python.repository.list),
      );
    };

    return (
      <RepositoryForm
        allowEditName={!item}
        errorMessages={errorMessages}
        isNew={!item}
        onCancel={closeModal}
        onSave={saveRepository}
        plugin='python'
        repository={repositoryToEdit}
        updateRepository={(r) => setState({ repositoryToEdit: r })}
      />
    );
  },
});

export default PythonRepositoryEdit;
