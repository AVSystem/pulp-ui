import { t } from '@lingui/core/macro';
import {
  Card,
  CardBody,
  CardExpandableContent,
  CardHeader,
  CardTitle,
  Gallery,
  GalleryItem,
  Progress,
} from '@patternfly/react-core';
import { sortBy } from 'lodash';
import { type ReactNode, useState } from 'react';
import {
  BaseHeader,
  DateComponent,
  LoadingSpinner,
  Main,
} from 'src/components';
import { InsufficientPermissions } from 'src/components/insufficient-permissions';
import { ListErrorState } from 'src/components/list-error-state';
import { useStatus } from 'src/entities/core/status/queries';
import { getHumanSize } from 'src/utilities/get-human-size';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import './pulp-status.scss';

const AsJSON = ({ data }: { data }) => (
  <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(data, null, 2)}</pre>
);

const StatusVersions = ({
  versions,
}: {
  versions: { component; version }[];
}) => {
  const sorted = sortBy(versions, 'component');

  return (
    <table style={{ width: '100%' }}>
      <tbody>
        {sorted.map(({ component, version }) => (
          <tr key={component}>
            <td>{component}</td>
            <td>{version}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

// A worker or an application process is keyed by its address when the server
// sends one. The name may be missing or shared by two processes, so without an
// address the position in the list keeps the key unique.
const processKey = (
  { pulp_href, name }: { pulp_href?: string; name? },
  index: number,
) => pulp_href ?? `${name ?? ''}-${index}`;

const StatusOnlineWorkers = ({
  onlineWorkers,
}: {
  onlineWorkers: {
    pulp_href?: string;
    current_task;
    last_heartbeat;
    name;
    pulp_created;
    pulp_last_updated;
  }[];
}) => (
  <>
    {onlineWorkers.map(
      (
        {
          pulp_href,
          current_task,
          last_heartbeat,
          name,
          pulp_created,
          pulp_last_updated,
        },
        i,
      ) => (
        <div
          key={processKey({ pulp_href, name }, i)}
          style={{ paddingTop: i ? '8px' : '0' }}
        >
          <strong>{t`Name`}</strong>: {name}
          <br />
          <strong>{t`Created`}</strong>: <DateComponent date={pulp_created} />
          <br />
          <strong>{t`Last updated`}</strong>:{' '}
          <DateComponent date={pulp_last_updated} />
          <br />
          <strong>{t`Last heartbeat`}</strong>:{' '}
          <DateComponent date={last_heartbeat} />
          <br />
          {/* TODO: link to tasks, show name */}
          <strong>{t`Current task`}</strong>:{' '}
          {current_task ? <AsJSON data={current_task} /> : t`None`}
        </div>
      ),
    )}
  </>
);

const StatusOnlineApps = ({
  apps,
}: {
  apps: { pulp_href?: string; name; last_heartbeat }[];
}) => (
  <>
    {apps.map(({ pulp_href, name, last_heartbeat }, i) => (
      <div
        key={processKey({ pulp_href, name }, i)}
        style={{ paddingTop: i ? '8px' : '0' }}
      >
        <strong>{t`Name`}</strong>: {name}
        <br />
        <strong>{t`Last heartbeat`}</strong>:{' '}
        <DateComponent date={last_heartbeat} />
      </div>
    ))}
  </>
);

const StatusOnlineApiApps = ({
  onlineApiApps,
}: {
  onlineApiApps: { pulp_href?: string; name; last_heartbeat }[];
}) => <StatusOnlineApps apps={onlineApiApps} />;

const StatusOnlineContentApps = ({
  onlineContentApps,
}: {
  onlineContentApps: { pulp_href?: string; name; last_heartbeat }[];
}) => <StatusOnlineApps apps={onlineContentApps} />;

const StatusDatabaseConnection = ({
  databaseConnection,
}: {
  databaseConnection: { connected: boolean };
}) => (databaseConnection?.connected ? t`Connected` : t`Not connected`);

const StatusRedisConnection = ({
  redisConnection,
}: {
  redisConnection: { connected: boolean };
}) => (redisConnection?.connected ? t`Connected` : t`Not connected`);

// pulpcore measures total and free space only when artifacts live on a
// filesystem. Every other backend reports both as null -- an object store has no
// capacity to measure -- and `storage` itself is null if the filesystem lookup
// raises. See _disk_usage() in pulpcore/app/views/status.py; the corresponding
// serializer fields are allow_null=True.
const isMeasured = (value): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const StatusStorage = ({
  storage,
}: {
  storage?: { total?: number; used?: number; free?: number };
}) => {
  const { total, used, free } = storage ?? {};

  // Only a real capacity makes a percentage meaningful. Without this guard
  // `(100 / null) * used` is Infinity, which Progress clamps to a full red bar,
  // reporting every object-storage install as out of space.
  const percentage =
    isMeasured(total) && total > 0 && isMeasured(used)
      ? (100 / total) * used
      : null;

  const size = (value) =>
    isMeasured(value) ? getHumanSize(value) : t`Not reported`;

  return (
    <>
      {percentage === null ? null : (
        <>
          <Progress
            value={percentage}
            title={t`Storage`}
            variant={
              percentage > 88
                ? 'danger'
                : percentage > 66
                  ? 'warning'
                  : percentage > 33
                    ? null
                    : 'success'
            }
          />
          <br />
        </>
      )}
      <strong>{t`Total`}</strong>: {size(total)}
      <br />
      <strong>{t`Used`}</strong>: {size(used)}
      <br />
      <strong>{t`Free`}</strong>: {size(free)}
    </>
  );
};

const StatusContentSettings = ({
  contentSettings,
}: {
  contentSettings: { content_origin; content_path_prefix };
}) => (
  <>
    <p>
      <strong>{t`Origin`}</strong>:{' '}
      <code>{contentSettings.content_origin}</code>
    </p>
    <p>
      <strong>{t`Path prefix`}</strong>:{' '}
      <code>{contentSettings.content_path_prefix}</code>
    </p>
  </>
);

const StatusDomainEnabled = ({ domainEnabled }: { domainEnabled: boolean }) =>
  domainEnabled ? t`Enabled` : t`Not enabled`;

const CardItem = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <GalleryItem>
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardBody>{children}</CardBody>
    </Card>
  </GalleryItem>
);

const CardJSON = ({ status }: { status }) => {
  const [expanded, setExpanded] = useState<boolean>(false);

  return (
    <Card isExpanded={expanded}>
      <CardHeader
        onExpand={() => setExpanded(!expanded)}
        toggleButtonProps={{
          'aria-expanded': expanded,
          'aria-label': t`JSON`,
        }}
      >
        <CardTitle onClick={() => setExpanded(!expanded)}>{t`JSON`}</CardTitle>
      </CardHeader>
      <CardExpandableContent>
        <CardBody>
          <AsJSON data={status} />
        </CardBody>
      </CardExpandableContent>
    </Card>
  );
};

// The cards of the answer, in the order they are shown. A card is listed only
// when its key is in the answer, so a reduced answer shows fewer cards and no
// placeholder stands in for the missing ones.
function cards(status) {
  const all: { key: string; title: string; body: ReactNode }[] = [
    {
      key: 'versions',
      title: t`Versions`,
      body: <StatusVersions versions={status.versions} />,
    },
    {
      key: 'storage',
      title: t`Storage`,
      body: <StatusStorage storage={status.storage} />,
    },
    {
      key: 'content_settings',
      title: t`Content settings`,
      body: <StatusContentSettings contentSettings={status.content_settings} />,
    },
    {
      key: 'database_connection',
      title: t`Database connection`,
      body: (
        <StatusDatabaseConnection
          databaseConnection={status.database_connection}
        />
      ),
    },
    {
      key: 'redis_connection',
      title: t`Redis connection`,
      body: <StatusRedisConnection redisConnection={status.redis_connection} />,
    },
    {
      key: 'domain_enabled',
      title: t`Domain enabled`,
      body: <StatusDomainEnabled domainEnabled={status.domain_enabled} />,
    },
    {
      key: 'online_workers',
      title: t`Online workers`,
      body: <StatusOnlineWorkers onlineWorkers={status.online_workers} />,
    },
    {
      key: 'online_api_apps',
      title: t`Online api apps`,
      body: <StatusOnlineApiApps onlineApiApps={status.online_api_apps} />,
    },
    {
      key: 'online_content_apps',
      title: t`Online content apps`,
      body: (
        <StatusOnlineContentApps
          onlineContentApps={status.online_content_apps}
        />
      ),
    },
  ];

  return all.filter(({ key }) => key in status);
}

// Says what the answer leaves out, chosen by the keys it holds. A visitor who
// is not signed in gets health only; a signed-in account that is not an
// administrator gets the versions but neither workers, storage nor content
// settings; an administrator's answer holds everything and needs no note.
function statusNote(status) {
  if (!('versions' in status)) {
    return (
      <p className='pulp-status-note'>
        {t`Versions, workers and storage are shown to signed-in users.`}
      </p>
    );
  }
  if (!('online_workers' in status)) {
    return (
      <p className='pulp-status-note'>
        {t`Workers, storage and content settings are shown to administrators.`}
      </p>
    );
  }
  return null;
}

// The status of the server, read through the shared query: the plugin list
// reads the same answer, so opening this screen after the page has loaded sends
// no second request. A read that failed is a retryable error state; a refusal
// is the insufficient permissions page; the end of the session shows nothing new
// because the sign-in dialog explains it and the screen reads again afterwards.
export default function PulpStatus() {
  const { data: status, error, isFetching, refetch } = useStatus();

  // While Retry (or the read after signing in again) runs, the failure gives
  // way to the spinner, as the screen has always done.
  const failed = Boolean(error) && !isSessionEnd(error);

  if (failed && !isFetching) {
    if (requestErrorStatus(error) === 403) {
      return (
        <>
          <BaseHeader title={t`Status`} />
          <InsufficientPermissions detail={requestErrorDetail(error)} />
        </>
      );
    }

    return (
      <>
        <BaseHeader title={t`Status`} />
        <Main>
          <section className='pulp-section'>
            <ListErrorState
              title={t`Failed to load status`}
              message={requestErrorDescription(error)}
              onRetry={() => void refetch()}
            />
          </section>
        </Main>
      </>
    );
  }

  return (
    <>
      <BaseHeader title={t`Status`} />
      <Main>
        {!status || failed ? (
          <LoadingSpinner />
        ) : (
          <section className='pulp-section'>
            {statusNote(status)}
            <Gallery hasGutter>
              {cards(status).map(({ key, title, body }) => (
                <CardItem key={key} title={title}>
                  {body}
                </CardItem>
              ))}
            </Gallery>
            {/* The raw answer is for a signed-in account: a reduced answer is
                shown as its cards only. */}
            {'versions' in status ? (
              <>
                <br />
                <CardJSON status={status} />
              </>
            ) : null}
          </section>
        )}
      </Main>
    </>
  );
}
