import { msg, t } from '@lingui/core/macro';
import { FileDistributionAPI } from 'src/api/file-distribution';
import {
  FileRepositoryAPI,
  type FileRepositoryType,
} from 'src/api/file-repository';
import { Page, RepositoryForm } from 'src/components';
import { Paths, formatPath } from 'src/paths';
import {
  createRepository,
  saveErrorMessages,
} from 'src/utilities/create-repository';
import { parsePulpIDFromURL } from 'src/utilities/parse-pulp-id';
import { taskAlert } from 'src/utilities/task-alert';

// retain_repo_versions null keeps every version of a new repository
const initialRepository: FileRepositoryType = {
  name: '',
  description: '',
  retain_repo_versions: null,
  pulp_labels: {},
  remote: null,
};

const FileRepositoryEdit = Page<FileRepositoryType>({
  breadcrumbs: ({ name }) =>
    [
      { url: formatPath(Paths.file.repository.list), name: t`Repositories` },
      name && {
        url: formatPath(Paths.file.repository.detail, { name }),
        name,
      },
      name ? { name: t`Edit` } : { name: t`Add` },
    ].filter(Boolean),

  displayName: 'FileRepositoryEdit',
  errorTitle: msg`Repository could not be displayed.`,
  listUrl: formatPath(Paths.file.repository.list),
  query: ({ name }) =>
    FileRepositoryAPI.list({ name }).then(
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
        navigate(formatPath(Paths.file.repository.detail, { name: data.name }));
      };

      try {
        if (item) {
          // editing never creates a distribution
          delete data.last_sync_task;
          delete data.last_synced_metadata_time;
          delete data.latest_version_href;
          delete data.pulp_created;
          delete data.pulp_href;
          delete data.versions_href;

          const { data: task } = await FileRepositoryAPI.update(
            parsePulpIDFromURL(item.pulp_href),
            data,
          );
          // the server answers with the repository itself, not a task, when
          // the update changes nothing
          queueAlert(
            task?.task
              ? taskAlert(task, t`Update started for repository ${data.name}`)
              : {
                  variant: 'success',
                  title: t`Updated repository ${data.name}`,
                },
          );
          goToRepository();
          return;
        }

        const { distributionError } = await createRepository({
          RepositoryAPI: FileRepositoryAPI,
          DistributionAPI: FileDistributionAPI,
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
          ? formatPath(Paths.file.repository.detail, {
              name: item.name,
            })
          : formatPath(Paths.file.repository.list),
      );
    };

    return (
      <RepositoryForm
        allowEditName={!item}
        errorMessages={errorMessages}
        isNew={!item}
        onCancel={closeModal}
        onSave={saveRepository}
        plugin='file'
        repository={repositoryToEdit}
        updateRepository={(r) => setState({ repositoryToEdit: r })}
      />
    );
  },
});

export default FileRepositoryEdit;
