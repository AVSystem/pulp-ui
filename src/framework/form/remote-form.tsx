import { t } from '@lingui/core/macro';
import { ActionGroup, Button } from '@patternfly/react-core';
import { useMemo, useRef, useState } from 'react';
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
import type { RemoteBase } from 'src/entities/plugin/model';
import { useEntityByName, useUpdateEntity } from 'src/entities/plugin/queries';
import type { RemoteChanges } from 'src/entities/plugin/remote';
import { changedFields } from 'src/utilities/changed-fields';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import type { PluginDescriptor } from '../descriptor';
import { useRereadAlert } from '../list/list-frame';
import type { FrameworkPlugin } from '../manifest';
import { remoteListPath, remotePath } from '../route-patterns';
import { DescriptorForm } from './descriptor-form';
import {
  type FormValues,
  changedNames,
  hasProblems,
  isSecret,
  toForm,
  toRequest,
} from './form-values';
import { FormPermissionGate } from './permission-gate';
import {
  NAME_FIELD,
  URL_FIELD,
  remoteFields,
  withTrailingSlash,
} from './remote-fields';
import { type SaveFailure, saveFailure } from './save-errors';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The address as the server takes it: a typed address gets the trailing slash
// the server asks for. Only a value that is being sent goes through here.
function withSlashedUrl(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const url = body[URL_FIELD];

  return typeof url === 'string'
    ? { ...body, [URL_FIELD]: withTrailingSlash(url.trim()) }
    : body;
}

// The failure of a save without the message of the field the user has since
// changed: a message stays under a value only until the value is edited.
function withoutMessageOf(
  failure: SaveFailure | null,
  field: string,
): SaveFailure | null {
  if (!failure || !(field in failure.fields)) {
    return failure;
  }
  return {
    ...failure,
    fields: Object.fromEntries(
      Object.entries(failure.fields).filter(([name]) => name !== field),
    ),
  };
}

// The edit form of a remote, drawn from the plugin's descriptor. The address
// names the remote, so another remote is another screen: what the one left
// behind held, typed values included, goes with it.
export const RemoteEdit = (props: Props) => {
  const { name } = useParams();

  return <RemoteEditScreen key={name} {...props} name={name} />;
};

// What the form holds once the user has changed it, with the object it was
// changed from. Until then the form shows what the last read holds, so a read
// that arrives after a sign-in refreshes an untouched form and never replaces
// one the user has changed.
interface Edit {
  values: FormValues;
  shown: RemoteBase;
}

const RemoteEditScreen = ({
  plugin,
  descriptor,
  name,
}: Props & { name?: string }) => {
  const remoteKind = descriptor.remote;

  if (!remoteKind) {
    throw new Error(
      `The ${plugin} descriptor declares no remotes, which their form needs`,
    );
  }

  const { entity } = remoteKind;
  const fields = useMemo(() => remoteFields(descriptor, 'edit'), [descriptor]);
  const query = useEntityByName(entity, name ?? null, {
    enabled: name !== undefined,
  });
  const update = useUpdateEntity<RemoteChanges, RemoteBase>(entity);
  const { queueAlert } = useAppContext();
  const navigate = useNavigate();

  const remote = query.data;
  const read = useMemo(
    () => (remote ? toForm(fields, remote) : undefined),
    [remote, fields],
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
  useRereadAlert(query, t`Remote could not be displayed.`, setAlerts);

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  if (
    name === undefined ||
    (query.isSuccess && remote === null) ||
    (!remote && status === 404)
  ) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the remote, with Pulp's own reason.
  if (!remote && status === 403) {
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

  if (!remote && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader title={name} />
        <Main>
          <ListErrorState
            title={t`Remote could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!remote || !values) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  const remoteName = remote.name;
  const detailPath = remotePath(plugin, remoteName);
  // The name is shown and never sent: a remote is not renamed here.
  const sentFields = fields.filter((field) => field.name !== NAME_FIELD);
  const shownNames = fields.map((field) => field.name);

  const change = (field: string, value: unknown) => {
    setEdit((current) => ({
      values: { ...(current?.values ?? values), [field]: value },
      shown: current?.shown ?? remote,
    }));
    setFailure((current) => withoutMessageOf(current, field));
  };

  // Sends only what the user changed, so a field somebody else changed in the
  // meantime is not overwritten with a value read earlier. A secret is sent
  // when a new value was typed (the value) or the stored one was cleared (null):
  // the server never returns a secret, so there is nothing to compare it with.
  // Nothing changed sends nothing. A failed save keeps the form as it is.
  const save = async () => {
    if (sending.current) {
      return;
    }
    sending.current = true;
    setFailure(null);
    try {
      const shown = edit?.shown ?? remote;
      const names = changedNames(sentFields, toForm(fields, shown), values);
      const secrets = sentFields.filter(
        (field) => names.includes(field.name) && isSecret(field),
      );
      const others = names.filter(
        (changed) => !secrets.some((field) => field.name === changed),
      );
      const changes: RemoteChanges = {
        ...changedFields(
          shown,
          withSlashedUrl(toRequest(sentFields, values, others)),
        ),
        ...toRequest(
          sentFields,
          values,
          secrets.map((field) => field.name),
        ),
      };

      if (Object.keys(changes).length === 0) {
        queueAlert({
          variant: 'info',
          title: t`Nothing changed in remote ${remoteName}.`,
        });
      } else {
        const result = await update.mutateAsync({
          href: remote.pulp_href,
          body: changes,
        });
        queueAlert(
          result.kind === 'task'
            ? taskAlert(result.task, t`Update started for remote ${remoteName}`)
            : {
                variant: 'success',
                title: t`Updated remote ${remoteName}`,
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
        repository={remote}
        permission={(permissions) => permissions.remote.change}
        title={remoteName}
        keep={edit !== null}
      >
        <BaseHeader
          title={remoteName}
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: remoteListPath(plugin), name: t`Remotes` },
                { url: detailPath, name: remoteName },
                { name: t`Edit` },
              ]}
            />
          }
        />
        <Main>
          <section className='pulp-section' data-cy='RemoteEdit'>
            <DescriptorForm
              fields={fields}
              values={values}
              errors={failure?.fields ?? {}}
              readOnly={[NAME_FIELD]}
              failure={failure?.general}
              failureTitle={t`Remote "${remoteName}" could not be updated`}
              onChange={change}
              onSubmit={save}
            >
              <ActionGroup>
                <Button
                  variant='primary'
                  isDisabled={
                    update.isPending ||
                    String(values[URL_FIELD] ?? '').trim() === '' ||
                    hasProblems(fields, values)
                  }
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
