import { t } from '@lingui/core/macro';
import {
  ActionGroup,
  Button,
  Content,
  Form,
  Skeleton,
} from '@patternfly/react-core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  Alert,
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  FormFieldHelper,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  Spinner,
  closeAlert,
} from 'src/components';
import { usePublicationsByHref } from 'src/entities/core/publication/queries';
import { useRepositoriesByHref } from 'src/entities/core/repository/queries';
import { repositoryOfVersion, versionNumberOf } from 'src/entities/href';
import type {
  DistributionBase,
  DistributionChanges,
} from 'src/entities/plugin/distribution';
import { repositoryOfPublication } from 'src/entities/plugin/publication';
import { useEntityByName, useUpdateEntity } from 'src/entities/plugin/queries';
import {
  basePathProblem,
  reservedPrefixFor,
} from 'src/utilities/base-path-rules';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import type { PluginDescriptor } from '../descriptor';
import { basePathMessage, reservedPrefixes } from '../form/distribution-option';
import { FormPermissionGate } from '../form/permission-gate';
import { type SaveFailure, saveFailure } from '../form/save-errors';
import type { FrameworkPlugin } from '../manifest';
import { distributionListPath, distributionPath } from '../route-patterns';
import { basePathConflict } from './create-distribution';
import { distributionChanges } from './distribution-changes';
import {
  BasePathGroup,
  NameGroup,
  SHOWN_FIELDS,
  ServerManagedGuard,
  withoutMessagesOf,
} from './distribution-fields';
import { pluginLabel } from './plugin-label';
import { type Protection, ProtectionChoice } from './protection-choice';
import {
  NO_SERVES,
  type ServesChoice,
  ServesField,
  servesComplete,
} from './serves-field';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The edit form of a distribution. The address names the distribution, so
// another distribution is another screen: what the one left behind held, typed
// values included, goes with it.
export const DistributionEdit = (props: Props) => {
  const { name } = useParams();

  return <DistributionEditScreen key={name} {...props} name={name} />;
};

// What the user has changed, with the distribution it was changed from. Until
// the first change the form shows what the last read holds, so a read that
// arrives after a sign-in refreshes an untouched form and never replaces one
// the user has changed. A field the user has not touched is undefined, and an
// untouched field is never sent.
interface Edit {
  basePath?: string;
  serves?: ServesChoice;
  protection?: Protection;
  shown: DistributionBase;
}

const NO_HREFS: string[] = [];

const DistributionEditScreen = ({
  plugin,
  descriptor,
  name,
}: Props & { name?: string }) => {
  const kind = descriptor.distribution;
  if (!kind) {
    throw new Error(
      `The ${plugin} descriptor declares no distributions, which their edit form needs`,
    );
  }
  const managed = kind.guardManagedByServer === true;
  const servesFromPublication =
    descriptor.publication?.servesFromPublication ?? false;
  const query = useEntityByName(kind.entity, name ?? null);
  const update = useUpdateEntity<DistributionChanges, DistributionBase>(
    kind.entity,
  );
  const { queueAlert } = useAppContext();
  const navigate = useNavigate();

  const distribution = query.data ?? undefined;
  const [edit, setEdit] = useState<Edit | null>(null);
  const [failure, setFailure] = useState<SaveFailure | null>(null);
  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [saving, setSaving] = useState(false);
  // A second press can arrive before the disabled button has rendered.
  const sending = useRef(false);

  // What the distribution serves now, named: the publication it is bound to and
  // the repository of that publication or the one it is bound to.
  const publicationHrefs = useMemo(
    () => (distribution?.publication ? [distribution.publication] : NO_HREFS),
    [distribution?.publication],
  );
  const publications = usePublicationsByHref(publicationHrefs);
  const publicationRow = distribution?.publication
    ? publications.publications?.get(distribution.publication)
    : undefined;
  const repositoryHref =
    distribution?.repository ??
    (publicationRow ? repositoryOfPublication(publicationRow) : null) ??
    repositoryOfVersion(distribution?.repository_version);
  const repositoryHrefs = useMemo(
    () => (repositoryHref ? [repositoryHref] : NO_HREFS),
    [repositoryHref],
  );
  const repositories = useRepositoriesByHref(repositoryHrefs);
  const reading =
    (publicationHrefs.length > 0 && publications.status === 'pending') ||
    (repositoryHrefs.length > 0 && repositories.status === 'pending');
  const repositoryRef = repositoryHref
    ? {
        href: repositoryHref,
        name:
          repositories.repositories?.get(repositoryHref)?.name ??
          t`A repository you may not see`,
      }
    : null;

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
          title: t`Distribution could not be displayed.`,
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
    (query.isSuccess && distribution === undefined) ||
    (!distribution && status === 404)
  ) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the distribution, with Pulp's own reason.
  if (!distribution && status === 403) {
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

  if (!distribution && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader title={name} />
        <Main>
          <ListErrorState
            title={t`Distribution could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!distribution) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  const shown = edit?.shown ?? distribution;
  const distributionName = distribution.name;
  const detailPath = distributionPath(plugin, distributionName);
  const typeName = pluginLabel(plugin);

  // The distribution is bound to a publication of a plugin that no longer
  // serves from publications: the binding is shown as such and kept until the
  // user serves the repository instead.
  const deprecatedPublication = !!shown.publication && !servesFromPublication;
  const initialServes: ServesChoice | undefined = shown.repository_version
    ? { mode: 'version', repository: null, publication: null }
    : shown.publication
      ? deprecatedPublication
        ? undefined
        : {
            mode: 'publication',
            repository: repositoryRef,
            publication: shown.publication,
          }
      : shown.repository
        ? { mode: 'repository', repository: repositoryRef, publication: null }
        : NO_SERVES;
  const serves = edit?.serves ?? initialServes;
  const protection: Protection =
    edit?.protection !== undefined
      ? edit.protection
      : typeof shown.content_guard === 'string'
        ? { guard: shown.content_guard }
        : null;
  // Public today, as the server says it: a guard that was not answered is not
  // taken for none.
  const publicNow = shown.content_guard === null;
  const basePath = edit?.basePath ?? shown.base_path;

  const prefixes = reservedPrefixes();
  const basePathChanged = basePath !== shown.base_path;
  const problem = basePathChanged ? basePathProblem(basePath) : null;
  const reserved = basePathChanged
    ? reservedPrefixFor(basePath, prefixes)
    : null;
  const message = basePathChanged
    ? basePathMessage({ problem, reserved })
    : null;
  const complete =
    (!basePathChanged ||
      (problem === null && reserved === null && prefixes !== null)) &&
    (edit?.serves === undefined || servesComplete(edit.serves)) &&
    (managed || protection !== null);

  const touch = (change: Partial<Omit<Edit, 'shown'>>) =>
    setEdit((current) => ({
      ...current,
      ...change,
      shown: current?.shown ?? distribution,
    }));

  // Sends only what the user changed, so a field somebody else changed in the
  // meantime is not overwritten with a value read earlier. Nothing changed
  // sends nothing. A failed save keeps the form as it is.
  const save = async () => {
    if (sending.current || !complete) {
      return;
    }
    sending.current = true;
    setSaving(true);
    setFailure(null);
    try {
      const changes = distributionChanges({
        plugin,
        distribution: shown,
        basePath,
        serves: edit?.serves,
        protection: edit?.protection,
        managed,
      });

      if (Object.keys(changes).length === 0) {
        queueAlert({
          variant: 'info',
          title: t`Nothing changed in distribution ${distributionName}.`,
        });
        navigate(detailPath);
        return;
      }

      if (changes.base_path !== undefined) {
        const blocked = await basePathConflict(
          changes.base_path,
          distributionName,
        );
        if (blocked) {
          setFailure({ fields: blocked.fields, general: blocked.general });
          return;
        }
      }

      const result = await update.mutateAsync({
        href: distribution.pulp_href,
        body: changes,
      });
      queueAlert(
        result.kind === 'task'
          ? taskAlert(
              result.task,
              t`Update started for distribution ${distributionName}`,
            )
          : {
              variant: 'success',
              title: t`Updated distribution ${distributionName}`,
            },
      );
      navigate(detailPath);
    } catch (error) {
      if (!isSessionEnd(error)) {
        setFailure(saveFailure(error, SHOWN_FIELDS));
      }
    } finally {
      sending.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      {alertList}
      <FormPermissionGate
        plugin={plugin}
        repository={distribution}
        permission={(permissions) => permissions.distribution.change}
        title={distributionName}
        keep={edit !== null}
      >
        <BaseHeader
          title={distributionName}
          subTitle={
            <Content component='p'>{t`${typeName} distribution`}</Content>
          }
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: distributionListPath(), name: t`Distributions` },
                { url: detailPath, name: distributionName },
                { name: t`Edit` },
              ]}
            />
          }
        />
        <Main>
          <section className='pulp-section' data-cy='DistributionEdit'>
            <Form onSubmit={(event) => event.preventDefault()}>
              <NameGroup value={distributionName} readOnly />
              <BasePathGroup
                value={basePath}
                message={message}
                error={failure?.fields['base_path']}
                onChange={(next) => {
                  touch({ basePath: next });
                  setFailure((current) =>
                    withoutMessagesOf(current, ['base_path']),
                  );
                }}
              />
              {basePathChanged && prefixes === null ? (
                <FormFieldHelper variant='warning'>
                  {t`The reserved base paths of this server could not be read, so the base path cannot be changed here.`}
                </FormFieldHelper>
              ) : null}
              {reading ? (
                <Skeleton width='40%' screenreaderText={t`Loading`} />
              ) : serves === undefined ? (
                <DeprecatedPublication
                  onServeRepository={() =>
                    touch({
                      serves: {
                        mode: 'repository',
                        repository: repositoryRef,
                        publication: null,
                      },
                    })
                  }
                />
              ) : (
                <ServesField
                  plugin={plugin}
                  descriptor={descriptor}
                  value={serves}
                  keptVersion={
                    shown.repository_version
                      ? versionNumberOf(shown.repository_version)
                      : undefined
                  }
                  error={
                    failure?.fields['repository'] ??
                    failure?.fields['publication']
                  }
                  onChange={(next) => {
                    touch({ serves: next });
                    setFailure((current) =>
                      withoutMessagesOf(current, ['repository', 'publication']),
                    );
                  }}
                />
              )}
              {managed ? (
                <ServerManagedGuard created={false} />
              ) : (
                <>
                  {publicNow ? (
                    <Alert
                      isInline
                      variant='warning'
                      title={t`This distribution is public now`}
                    >
                      {t`Anyone who can reach this server can download from it without signing in. Choose a content guard, or confirm Public, to save your changes.`}
                    </Alert>
                  ) : null}
                  <ProtectionChoice
                    value={protection}
                    onChange={(next) => touch({ protection: next })}
                  />
                </>
              )}
              {failure?.general ? (
                <Alert
                  variant='danger'
                  isInline
                  isLiveRegion
                  title={t`Distribution "${distributionName}" could not be updated`}
                  className='pulp-break-anywhere'
                >
                  {failure.general}
                </Alert>
              ) : null}
              <ActionGroup>
                <Button
                  variant='primary'
                  isDisabled={saving || !complete}
                  onClick={save}
                >
                  {t`Save`}
                  {saving && <Spinner size='sm' />}
                </Button>
                <Button variant='link' onClick={() => navigate(detailPath)}>
                  {t`Cancel`}
                </Button>
              </ActionGroup>
            </Form>
          </section>
        </Main>
      </FormPermissionGate>
    </>
  );
};

// What the form says about a distribution that is bound to a publication of a
// plugin that has deprecated publications, and the one way to leave it.
const DeprecatedPublication = ({
  onServeRepository,
}: {
  onServeRepository: () => void;
}) => (
  <Alert
    isInline
    variant='warning'
    title={t`Bound to a deprecated publication`}
    actionLinks={
      <Button variant='link' isInline onClick={onServeRepository}>
        {t`Serve the repository instead`}
      </Button>
    }
  >
    {t`This distribution serves a publication, which this plugin has deprecated. It keeps serving it until you serve the repository instead; the repository's latest version is then served directly.`}
  </Alert>
);
