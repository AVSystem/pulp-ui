import { t } from '@lingui/core/macro';
import { ActionGroup, Button } from '@patternfly/react-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  Spinner,
  closeAlert,
} from 'src/components';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useEntityByName, useUpdateEntity } from 'src/entities/plugin/queries';
import type { RepositoryChanges } from 'src/entities/plugin/repository';
import { changedFields } from 'src/utilities/changed-fields';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import { type FrameworkPlugin, repositoryPermissions } from '../manifest';
import { repositoryListPath, repositoryPath } from '../route-patterns';
import { DescriptorForm } from './descriptor-form';
import {
  type FormValues,
  changedNames,
  hasProblems,
  toForm,
  toRequest,
} from './form-values';
import { FormPermissionGate } from './permission-gate';
import { NAME_FIELD, repositoryFields } from './repository-fields';
import { type SaveFailure, saveFailure } from './save-errors';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The edit form of a repository, drawn from the plugin's descriptor. The
// address names the repository, so another repository is another screen: what
// the one left behind held, typed values included, goes with it.
export const RepositoryEdit = (props: Props) => {
  const { name } = useParams();

  return <RepositoryEditScreen key={name} {...props} name={name} />;
};

// What the form holds once the user has changed it, with the object it was
// changed from. Until then the form shows what the last read holds, so a read
// that arrives after a sign-in refreshes an untouched form and never replaces
// one the user has changed.
interface Edit {
  values: FormValues;
  shown: RepositoryBase;
}

const RepositoryEditScreen = ({
  plugin,
  descriptor,
  name,
}: Props & { name?: string }) => {
  const { entity } = repositoryOf(descriptor);
  const fields = useMemo(() => repositoryFields(descriptor), [descriptor]);
  const query = useEntityByName(entity, name ?? null);
  const update = useUpdateEntity<RepositoryChanges, RepositoryBase>(entity);
  const { queueAlert } = useAppContext();
  const navigate = useNavigate();

  const repository = query.data;
  const read = useMemo(
    () => (repository ? toForm(fields, repository) : undefined),
    [repository, fields],
  );
  const [edit, setEdit] = useState<Edit | null>(null);
  const values = edit?.values ?? read;

  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  // A second press can arrive before the disabled button has rendered.
  const sending = useRef(false);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // The form on screen is never replaced by the failure of a later read: it
  // stays, and the failure is reported next to it, once.
  const alerted = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded;
  useEffect(() => {
    if (rereadFailed && alerted.current !== query.errorUpdatedAt) {
      alerted.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: t`Repository could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  if (
    name === undefined ||
    (query.isSuccess && repository === null) ||
    (!repository && status === 404)
  ) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the repository, with Pulp's own reason.
  if (!repository && status === 403) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions
          detail={requestErrorDetail(query.error)}
          showTitle={false}
        />
      </>
    );
  }

  if (!repository && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader title={name} />
        <Main>
          <ListErrorState
            title={t`Repository could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!repository || !values) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  const repositoryName = repository.name;
  const detailPath = repositoryPath(plugin, repositoryName);
  // The name is shown and never sent: a repository is not renamed here.
  const sentFields = fields.filter((field) => field.name !== NAME_FIELD);
  const shownNames = fields.map((field) => field.name);

  const change = (field: string, value: unknown) => {
    setEdit((current) => ({
      values: { ...(current?.values ?? values), [field]: value },
      shown: current?.shown ?? repository,
    }));
    setFailure((current) => {
      if (!current || !(field in current.fields)) {
        return current;
      }
      return {
        ...current,
        fields: Object.fromEntries(
          Object.entries(current.fields).filter(([name]) => name !== field),
        ),
      };
    });
  };

  // Sends only what the user changed, so a field somebody else changed in the
  // meantime is not overwritten with a value read earlier. Nothing changed
  // sends nothing. A failed save keeps the form as it is.
  const save = async () => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setFailure(null);
    try {
      const shown = edit?.shown ?? repository;
      const names = changedNames(sentFields, toForm(fields, shown), values);
      const changes = changedFields(
        shown,
        toRequest(sentFields, values, names),
      );

      if (Object.keys(changes).length === 0) {
        queueAlert({
          variant: 'info',
          title: t`Nothing changed in repository ${repositoryName}.`,
        });
      } else {
        const result = await update.mutateAsync({
          href: repository.pulp_href,
          body: changes,
        });
        queueAlert(
          result.kind === 'task'
            ? taskAlert(
                result.task,
                t`Update started for repository ${repositoryName}`,
              )
            : {
                variant: 'success',
                title: t`Updated repository ${repositoryName}`,
              },
        );
      }
      navigate(detailPath);
    } catch (error) {
      setFailure(saveFailure(error, shownNames));
    } finally {
      sending.current = false;
    }
  };

  return (
    <>
      {alertList}
      <FormPermissionGate
        plugin={plugin}
        repository={repository}
        permission={(permissions) => repositoryPermissions(permissions).change}
        title={repositoryName}
        keep={edit !== null}
      >
        <BaseHeader
          title={repositoryName}
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: repositoryListPath(plugin), name: t`Repositories` },
                { url: detailPath, name: repositoryName },
                { name: t`Edit` },
              ]}
            />
          }
        />
        <Main>
          <section className='pulp-section' data-cy='RepositoryEdit'>
            <DescriptorForm
              fields={fields}
              values={values}
              errors={failure?.fields ?? {}}
              readOnly={[NAME_FIELD]}
              remotes={descriptor.remote?.entity}
              failure={failure?.general}
              failureTitle={t`Repository "${repositoryName}" could not be updated`}
              onChange={change}
            >
              <ActionGroup>
                <Button
                  variant='primary'
                  isDisabled={update.isPending || hasProblems(fields, values)}
                  onClick={save}
                >
                  {t`Save`}
                  {update.isPending && <Spinner size='sm' />}
                </Button>
                <Button variant='link' onClick={() => navigate(detailPath)}>
                  {t`Cancel`}
                </Button>
              </ActionGroup>
            </DescriptorForm>
          </section>
        </Main>
      </FormPermissionGate>
    </>
  );
};
