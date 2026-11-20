import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router';
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
  closeAlert,
} from 'src/components';
import { useEntityByName } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { PluginDescriptor } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import {
  type RepositoryTab,
  repositoryListPath,
  repositoryPath,
} from '../route-patterns';

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
  const { entity, detailRows, tabs: pluginTabs = [] } = descriptor.repository;
  const [alerts, setAlerts] = useState<AlertType[]>([]);

  const shown = tab === null ? null : pluginTabs.find(({ id }) => id === tab);
  const version = number === undefined ? null : Number(number);
  // An address the plugin has no screen for reads nothing.
  const known =
    name !== undefined &&
    (tab === null || shown !== undefined) &&
    (number === undefined || DIGITS.test(number));

  const query = useEntityByName(entity, name ?? null, { enabled: known });
  const repository = query.data;

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
      >
        <div className='pulp-tab-link-container'>
          <div className='tabs'>
            <LinkTabs tabs={tabLinks} />
          </div>
        </div>
      </BaseHeader>
      <Main>
        <section
          className='pulp-section'
          data-cy={`RepositoryDetail-${tab ?? 'details'}`}
        >
          {shown ? (
            shown.render({ repository, version })
          ) : (
            <Details
              fields={detailRows.map(({ label, render }) => ({
                label: i18n._(label),
                value: render(repository),
              }))}
            />
          )}
        </section>
      </Main>
    </>
  );
};
