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
import { Component, type ReactNode, useState } from 'react';
import { PulpStatusAPI } from 'src/api';
import {
  BaseHeader,
  DateComponent,
  LoadingSpinner,
  Main,
} from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { type RouteProps, getHumanSize, withRouter } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import './pulp-status.scss';

interface IState {
  // why the last read failed, shown as an error state with Retry
  error: ReactNode;
  status?;
}

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

const StatusOnlineWorkers = ({
  onlineWorkers,
}: {
  onlineWorkers: {
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
        { current_task, last_heartbeat, name, pulp_created, pulp_last_updated },
        i,
      ) => (
        <div key={name} style={{ paddingTop: i ? '8px' : '0' }}>
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

const StatusOnlineApps = ({ apps }: { apps: { name; last_heartbeat }[] }) => (
  <>
    {apps.map(({ name, last_heartbeat }, i) => (
      <div key={name} style={{ paddingTop: i ? '8px' : '0' }}>
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
  onlineApiApps: { name; last_heartbeat }[];
}) => <StatusOnlineApps apps={onlineApiApps} />;

const StatusOnlineContentApps = ({
  onlineContentApps,
}: {
  onlineContentApps: { name; last_heartbeat }[];
}) => <StatusOnlineApps apps={onlineContentApps} />;

const StatusDatabaseConnection = ({
  databaseConnection,
}: {
  databaseConnection: { connected: boolean };
}) => (databaseConnection?.connected ? t`Connected` : `Not connected`);

const StatusRedisConnection = ({
  redisConnection,
}: {
  redisConnection: { connected: boolean };
}) => (redisConnection?.connected ? t`Connected` : `Not connected`);

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

class PulpStatus extends Component<RouteProps, IState> {
  constructor(props) {
    super(props);

    this.state = {
      error: null,
      status: null,
    };
  }

  componentDidMount() {
    this.query();
  }

  componentDidUpdate(prevProps: RouteProps) {
    // The same user signed in again: read the status again, which now holds
    // everything a signed-in user may see.
    if (prevProps.sessionEpoch !== this.props.sessionEpoch) {
      this.query();
    }
  }

  render() {
    const { error, status } = this.state;

    return (
      <>
        <BaseHeader title={t`Status`} />
        <Main>
          {error ? (
            <section className='pulp-section'>
              <ListErrorState
                title={t`Failed to load status`}
                message={error}
                onRetry={() => this.retry()}
              />
            </section>
          ) : !status ? (
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
              {/* The raw answer is for a signed-in account: a reduced answer
                  is shown as its cards only. */}
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

  private retry() {
    this.setState({ error: null, status: null });
    this.query();
  }

  private query() {
    PulpStatusAPI.get()
      .then(({ data }) => {
        this.setState({ error: null, status: data });
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it, and the page
        // keeps its spinner or its content until it reads again.
        if (isSessionEnd(e)) {
          return;
        }
        this.setState({ error: requestErrorDescription(e) });
      });
  }
}

export default withRouter(PulpStatus);
