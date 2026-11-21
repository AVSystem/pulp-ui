import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Button, Flex, FlexItem, Skeleton } from '@patternfly/react-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  Details,
  InsufficientPermissions,
  LinkTabs,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  PulpCodeBlock,
  closeAlert,
} from 'src/components';
import { CopyURL } from 'src/components';
import type { RemoteBase } from 'src/entities/plugin/model';
import { useEntityByName } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { DeleteRemoteDialog } from '../delete/delete-remote-dialog';
import type { PluginDescriptor } from '../descriptor';
import { LabelEditor } from '../labels/label-editor';
import { UsedBy } from '../list/used-by';
import type { FrameworkPlugin } from '../manifest';
import { remoteEditPath, remoteListPath, remotePath } from '../route-patterns';
import { useQueuedAlerts } from '../use-queued-alerts';
import { useRemoteUsers } from './remote-users';
import { useRemotePermission } from './use-remote-permission';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// How many of the repositories that use a remote the Details tab names before
// it counts the rest.
const NAMED_USERS = 10;

// A remote's detail: its Details tab. The address names the remote, and the
// object is held by its own address once it is read, so a rename leaves the old
// link on Not Found. Another remote is another screen: what the one left behind
// showed, its alerts included, goes with it.
export const RemoteDetail = (props: Props) => {
  const { name } = useParams();

  return <RemoteDetailScreen key={name} {...props} name={name} />;
};

// The name of a secret field of a remote as a person reads it. A field the
// server may add later is shown by its own name.
function secretFieldText(name: string): string {
  switch (name) {
    case 'username':
      return t`Username`;
    case 'password':
      return t`Password`;
    case 'proxy_username':
      return t`Proxy username`;
    case 'proxy_password':
      return t`Proxy password`;
    case 'client_key':
      return t`Client key`;
    case 'token':
      return t`Token`;
    default:
      return name.replace(/_/g, ' ');
  }
}

const MaybeCode = ({
  code,
  filename,
}: {
  code?: string | null;
  filename: string;
}) =>
  code ? <PulpCodeBlock code={code} filename={filename} /> : <>{t`None`}</>;

// The repositories that use the remote: the first few, linked, and a link to
// the rest. A read that failed says so and offers to read again, so a missing
// name is never mistaken for none.
const RepositoriesRow = ({
  plugin,
  descriptor,
  remote,
}: Props & { remote: RemoteBase }) => {
  const users = useRemoteUsers(descriptor.repository.entity, remote.pulp_href);

  if (users.state === 'error') {
    return (
      <>
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`Repositories could not be loaded`}
        </span>{' '}
        <Button variant='link' isInline onClick={users.retry}>
          {t`Retry`}
        </Button>
      </>
    );
  }
  if (users.state === 'loading') {
    return <Skeleton width='60%' />;
  }

  return (
    <UsedBy
      plugin={plugin}
      remote={remote.pulp_href}
      state={users.state}
      users={users.users}
      total={users.total}
      limit={NAMED_USERS}
    />
  );
};

// The Details tab of a remote: the rows every remote has, the rows the plugin
// adds, the secret fields that are set (by name, never by value), the
// repositories that use it and its labels, which a user who may change the
// remote can edit.
const DetailsTab = ({
  plugin,
  descriptor,
  remote,
}: Props & { remote: RemoteBase }) => {
  const mayChange = useRemotePermission(plugin, remote, 'change');
  const secrets = (remote.hidden_fields ?? [])
    .filter(({ is_set }) => is_set)
    .map(({ name }) => secretFieldText(name));

  return (
    <Details
      fields={[
        { label: t`Remote name`, value: remote.name },
        { label: t`URL`, value: <CopyURL url={remote.url ?? ''} fallback /> },
        {
          label: t`Proxy URL`,
          value: <CopyURL url={remote.proxy_url ?? ''} fallback />,
        },
        {
          label: t`TLS validation`,
          value: remote.tls_validation ? t`Enabled` : t`Disabled`,
        },
        {
          label: t`Client certificate`,
          value: (
            <MaybeCode
              code={remote.client_cert}
              filename={`${remote.name}-client_cert`}
            />
          ),
        },
        {
          label: t`CA certificate`,
          value: (
            <MaybeCode
              code={remote.ca_cert}
              filename={`${remote.name}-ca_cert`}
            />
          ),
        },
        {
          label: t`Download concurrency`,
          value: remote.download_concurrency ?? t`None`,
        },
        { label: t`Rate limit`, value: remote.rate_limit ?? t`None` },
        ...(descriptor.remote?.detailRows ?? []).map(({ label, render }) => ({
          label: i18n._(label),
          value: render(remote),
        })),
        {
          label: t`Stored credentials`,
          value: secrets.length > 0 ? secrets.join(', ') : t`None`,
        },
        {
          label: t`Repositories`,
          value: (
            <RepositoriesRow
              plugin={plugin}
              descriptor={descriptor}
              remote={remote}
            />
          ),
        },
        {
          label: t`Labels`,
          value: (
            <LabelEditor
              object={remote}
              entity={
                (descriptor.remote as NonNullable<typeof descriptor.remote>)
                  .entity
              }
              canEdit={mayChange}
            />
          ),
        },
      ]}
    />
  );
};

const RemoteDetailScreen = ({
  plugin,
  descriptor,
  name,
}: Props & { name?: string }) => {
  const entity = descriptor.remote?.entity;

  if (!entity) {
    throw new Error(
      `The ${plugin} descriptor declares no remotes, which their detail needs`,
    );
  }

  // The alerts another screen queued for this one (the result of an edit) are
  // taken over once, so they show here and nowhere else.
  const { alerts, setAlerts, handOver } = useQueuedAlerts();
  const navigate = useNavigate();

  const query = useEntityByName(entity, name ?? null, {
    enabled: name !== undefined,
  });
  const remote = query.data;

  const mayEdit = useRemotePermission(plugin, remote, 'change');
  const mayDelete = useRemotePermission(plugin, remote, 'delete');
  const [deleting, setDeleting] = useState(false);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // The remote on screen is never replaced by the failure of a later read: it
  // stays, and the failure is reported next to it, once.
  const alerted = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded;
  const addAlert = useCallback(
    (alert: AlertType) => setAlerts((current) => [...current, alert]),
    [setAlerts],
  );
  useEffect(() => {
    if (rereadFailed && alerted.current !== query.errorUpdatedAt) {
      alerted.current = query.errorUpdatedAt;
      addAlert({
        variant: 'danger',
        title: t`Remote could not be displayed.`,
        description: requestErrorDescription(query.error),
      });
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error, addAlert]);

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // The name is unique, so a read that found nothing is a remote that does not
  // exist (or no longer under this name).
  if (name === undefined || (query.isSuccess && remote === null)) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the remote, with Pulp's own reason.
  if (!remote && status === 403) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!remote && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader
          title={name}
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: remoteListPath(plugin), name: t`Remotes` },
                { name },
              ]}
            />
          }
        />
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

  if (!remote) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  return (
    <>
      {alertList}
      <BaseHeader
        title={remote.name}
        breadcrumbs={
          <Breadcrumbs
            links={[
              { url: remoteListPath(plugin), name: t`Remotes` },
              { name: remote.name },
            ]}
          />
        }
        pageControls={
          mayEdit || mayDelete ? (
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              {mayEdit ? (
                <FlexItem>
                  <Button
                    variant='secondary'
                    onClick={() =>
                      navigate(remoteEditPath(plugin, remote.name))
                    }
                  >
                    {t`Edit`}
                  </Button>
                </FlexItem>
              ) : null}
              {mayDelete ? (
                <FlexItem>
                  <Button
                    variant='secondary'
                    isDanger
                    onClick={() => setDeleting(true)}
                  >
                    {t`Delete`}
                  </Button>
                </FlexItem>
              ) : null}
            </Flex>
          ) : undefined
        }
      >
        <div className='pulp-tab-link-container'>
          <div className='tabs'>
            <LinkTabs
              tabs={[
                {
                  active: true,
                  title: t`Details`,
                  link: remotePath(plugin, remote.name),
                },
              ]}
            />
          </div>
        </div>
      </BaseHeader>
      {deleting ? (
        <DeleteRemoteDialog
          descriptor={descriptor}
          remote={remote}
          onClose={() => setDeleting(false)}
          onAccepted={(alert) => {
            // The delete is accepted and its task is followed from here on:
            // the list is where the user goes, and it shows the alert.
            handOver(alert);
            navigate(remoteListPath(plugin));
          }}
        />
      ) : null}
      <Main>
        <section className='pulp-section' data-cy='RemoteDetail-details'>
          <DetailsTab plugin={plugin} descriptor={descriptor} remote={remote} />
        </section>
      </Main>
    </>
  );
};
