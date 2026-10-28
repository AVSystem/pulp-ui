import { msg, t } from '@lingui/core/macro';
import { AnsibleDistributionAPI } from 'src/api/ansible-distribution';
import {
  AnsibleRepositoryAPI,
  type AnsibleRepositoryType,
} from 'src/api/ansible-repository';
import { Page, RepositoryForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import {
  createRepository,
  saveErrorMessages,
} from 'src/utilities/create-repository';
import { parsePulpIDFromURL } from 'src/utilities/parse-pulp-id';
import { taskAlert } from 'src/utilities/task-alert';

// retain_repo_versions null keeps every version of a new repository
const initialRepository: AnsibleRepositoryType = {
  name: '',
  description: '',
  retain_repo_versions: null,
  pulp_labels: {},
  remote: null,
};

const AnsibleRepositoryEdit = Page<AnsibleRepositoryType>({
  breadcrumbs: ({ name }) =>
    [
      { url: formatPath(Paths.ansible.repository.list), name: t`Repositories` },
      name && {
        url: formatPath(Paths.ansible.repository.detail, { name }),
        name,
      },
      name ? { name: t`Edit` } : { name: t`Add` },
    ].filter(Boolean),

  displayName: 'AnsibleRepositoryEdit',
  errorTitle: msg`Repository could not be displayed.`,
  listUrl: formatPath(Paths.ansible.repository.list),
  query: ({ name }) => {
    return AnsibleRepositoryAPI.list({ name })
      .then(({ data: { results } }) => results[0])
      .then((repository) => {
        return AnsibleRepositoryAPI.myPermissions(
          parsePulpIDFromURL(repository.pulp_href),
        )
          .then(({ data: { permissions } }) => permissions)
          .catch((e) => {
            console.error(e);
            return [];
          })
          .then((my_permissions) => ({ ...repository, my_permissions }));
      });
  },

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
          formatPath(Paths.ansible.repository.detail, { name: data.name }),
        );
      };

      try {
        if (item) {
          // editing never creates a distribution
          delete data.my_permissions;
          delete data.last_sync_task;
          delete data.last_synced_metadata_time;
          delete data.latest_version_href;
          delete data.pulp_created;
          delete data.pulp_href;
          delete data.versions_href;

          const { data: task } = await AnsibleRepositoryAPI.update(
            parsePulpIDFromURL(item.pulp_href),
            data,
          );
          queueAlert(
            taskAlert(task, t`Update started for repository ${data.name}`),
          );
          goToRepository();
          return;
        }

        const { distributionError } = await createRepository({
          RepositoryAPI: AnsibleRepositoryAPI,
          DistributionAPI: AnsibleDistributionAPI,
          data,
          distribution,
        });

        if (distributionError) {
          queueAlert({
            variant: 'danger',
            title: t`Repository "${data.name}" was created. The distribution "${data.name}" was not created: ${distributionError}`,
          });
        } else {
          queueAlert({
            variant: 'success',
            title: t`Successfully created repository ${data.name}`,
          });
          if (distribution) {
            const { basePath } = distribution;
            queueAlert({
              variant: 'success',
              title: t`Created distribution "${data.name}" at base path ${basePath}.`,
            });
          }
        }
        goToRepository();
      } catch (e) {
        setState({ errorMessages: saveErrorMessages(e) });
      }
    };

    const closeModal = () => {
      setState({ errorMessages: {}, repositoryToEdit: undefined });
      navigate(
        item
          ? formatPath(Paths.ansible.repository.detail, {
              name: item.name,
            })
          : formatPath(Paths.ansible.repository.list),
      );
    };

    return (
      <RepositoryForm
        allowEditName={!item}
        errorMessages={errorMessages}
        isNew={!item}
        onCancel={closeModal}
        onSave={saveRepository}
        plugin='ansible'
        repository={repositoryToEdit}
        updateRepository={(r) => setState({ repositoryToEdit: r })}
      />
    );
  },
});

export default AnsibleRepositoryEdit;
