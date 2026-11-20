import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { Button, Flex, FlexItem } from '@patternfly/react-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  InsufficientPermissions,
  LinkTabs,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  closeAlert,
} from 'src/components';
import { useEntityByName } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { DeleteRepositoryDialog } from '../delete/delete-repository-dialog';
import type { PluginDescriptor } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import {
  type RepositoryTab,
  repositoryEditPath,
  repositoryListPath,
  repositoryPath,
} from '../route-patterns';
import { SyncProgressPanel } from '../sync/progress-panel';
import { SyncDialog } from '../sync/sync-dialog';
import { useQueuedAlerts } from '../use-queued-alerts';
import { DetailsTab } from './details-tab';
import { useRepositoryPermission } from './use-repository-permission';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  // The tab the address shows; null on the repository's own address, which is
  // the Details tab.
  tab: RepositoryTab | null;
}

// A version number is only ever the digits of an address segment; anything
// else names no version.
const DIGITS = /^\d+$/;

// A repository's detail: its Details tab and the tabs its plugin declares. The
// address names the repository, and the object is held by its own address once
// it is read, so a rename leaves the old link on Not Found. Another repository
// is another screen: what the one left behind showed, its alerts included, goes
// with it.
export const RepositoryDetail = (props: Props) => {
  const { name, number } = useParams();

  return (
    <RepositoryDetailScreen key={name} {...props} name={name} number={number} />
  );
};

const RepositoryDetailScreen = ({
  plugin,
  descriptor,
  tab,
  name,
  number,
}: Props & { name?: string; number?: string }) => {
  const { entity, tabs: pluginTabs = [] } = descriptor.repository;
  // The alerts another screen queued for this one (the result of an edit) are
  // taken over once, so they show here and nowhere else, also when they are
  // queued while this screen is already shown.
  const { alerts, setAlerts, handOver } = useQueuedAlerts();
  const navigate = useNavigate();

  const shown = tab === null ? null : pluginTabs.find(({ id }) => id === tab);
  const version = number === undefined ? null : Number(number);
  // An address the plugin has no screen for reads nothing.
  const known =
    name !== undefined &&
    (tab === null || shown !== undefined) &&
    (number === undefined || DIGITS.test(number));

  const query = useEntityByName(entity, name ?? null, { enabled: known });
  const repository = query.data;

  // Whether the user may edit the repository: the change permission is held on
  // every repository or on this one.
  const mayEdit = useRepositoryPermission(plugin, repository, 'change');
  // Whether it may delete it, with the distributions that serve it.
  const mayDelete = useRepositoryPermission(plugin, repository, 'delete');
  const [deleting, setDeleting] = useState(false);
  // Whether it may sync it: the plugin has a sync, the repository has a remote
  // to sync from, and the user holds the sync permission.
  const maySync = useRepositoryPermission(plugin, repository, 'sync');
  const canSync =
    descriptor.repository.sync !== undefined && maySync && !!repository?.remote;
  const [syncing, setSyncing] = useState(false);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // The repository on screen is never replaced by the failure of a later read:
  // it stays, and the failure is reported next to it, once.
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

  // The same refusal of the same action stays one alert while it is open.
  const addAlert = useCallback(
    (alert: AlertType) =>
      setAlerts((current) =>
        alert.id !== undefined && current.some(({ id }) => id === alert.id)
          ? current
          : [...current, alert],
      ),
    [],
  );

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // The name is unique, so a read that found nothing is a repository that does
  // not exist (or no longer under this name).
  if (!known || (query.isSuccess && repository === null)) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the repository, with Pulp's own reason.
  if (!repository && status === 403) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!repository && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader
          title={name as string}
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: repositoryListPath(plugin), name: t`Repositories` },
                { name: name as string },
              ]}
            />
          }
        />
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

  if (!repository) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  const tabLinks = [
    {
      active: tab === null,
      title: t`Details`,
      link: repositoryPath(plugin, repository.name),
    },
    ...pluginTabs.map(({ id, label }) => ({
      active: tab === id,
      title: i18n._(label),
      link: repositoryPath(plugin, repository.name, id),
    })),
  ];

  return (
    <>
      {alertList}
      <BaseHeader
        title={repository.name}
        breadcrumbs={
          <Breadcrumbs
            links={[
              { url: repositoryListPath(plugin), name: t`Repositories` },
              { name: repository.name },
            ]}
          />
        }
        pageControls={
          canSync || mayEdit || mayDelete ? (
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              {canSync ? (
                <FlexItem>
                  <Button variant='primary' onClick={() => setSyncing(true)}>
                    {t`Sync`}
                  </Button>
                </FlexItem>
              ) : null}
              {mayEdit ? (
                <FlexItem>
                  <Button
                    variant='secondary'
                    onClick={() =>
                      navigate(repositoryEditPath(plugin, repository.name))
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
            <LinkTabs tabs={tabLinks} />
          </div>
        </div>
      </BaseHeader>
      {syncing ? (
        <SyncDialog
          descriptor={descriptor}
          repository={repository}
          onClose={() => setSyncing(false)}
        />
      ) : null}
      {deleting ? (
        <DeleteRepositoryDialog
          descriptor={descriptor}
          repository={repository}
          onClose={() => setDeleting(false)}
          onDeleted={(alert) => {
            // The repository is gone: the list is where the user goes, and it
            // shows the result.
            handOver(alert);
            navigate(repositoryListPath(plugin));
          }}
        />
      ) : null}
      <Main>
        <SyncProgressPanel repository={repository} descriptor={descriptor} />
        <section
          className='pulp-section'
          data-cy={`RepositoryDetail-${tab ?? 'details'}`}
        >
          {shown ? (
            shown.render({
              repository,
              version,
              plugin,
              descriptor,
              addAlert,
            })
          ) : (
            <DetailsTab
              plugin={plugin}
              descriptor={descriptor}
              repository={repository}
            />
          )}
        </section>
      </Main>
    </>
  );
};
