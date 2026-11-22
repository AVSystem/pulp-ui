import { t } from '@lingui/core/macro';
import { Button, Content, Flex, FlexItem } from '@patternfly/react-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  DateComponent,
  Details,
  InsufficientPermissions,
  ListErrorState,
  LoadingPage,
  Main,
  NotFound,
  closeAlert,
} from 'src/components';
import { DistributionURL } from 'src/components/distribution-url';
import { guardKindOf } from 'src/entities/core/content-guard/client';
import { useContentGuardNames } from 'src/entities/core/content-guard/queries';
import type { DistributionBase } from 'src/entities/plugin/distribution';
import { useEntityByName } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { PluginDescriptor } from '../descriptor';
import { LabelEditor } from '../labels/label-editor';
import type { FrameworkPlugin } from '../manifest';
import { distributionListPath } from '../route-patterns';
import { useQueuedAlerts } from '../use-queued-alerts';
import { DeleteDistributionDialog } from './delete-distribution-dialog';
import { GuardValue, PublicLabel, ServesValue } from './distribution-columns';
import { pluginLabel } from './plugin-label';
import { useDistributionPermission } from './use-distribution-permission';
import { useDistributionServing } from './use-distribution-serving';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
}

// The page of one distribution. The address names the distribution, and the
// object is held by its own address once it is read, so a rename leaves the
// old link on Not Found. Another distribution is another screen: what the one
// left behind showed, its alerts included, goes with it.
export const DistributionDetail = (props: Props) => {
  const { name } = useParams();

  return <DistributionDetailScreen key={name} {...props} name={name} />;
};

interface RowsProps extends Props {
  distribution: DistributionBase;
}

// The rows of the page: where clients reach the distribution and whether that
// works, what it serves, how it is protected, its labels, which a user who may
// change the distribution can edit, and when it was made. What a read has not
// settled is said so and never reads as "nothing".
const DistributionRows = ({ plugin, descriptor, distribution }: RowsProps) => {
  const kind = descriptor.distribution;
  if (!kind) {
    throw new Error(
      `The ${plugin} descriptor declares no distributions, which their detail needs`,
    );
  }
  const serving = useDistributionServing({ plugin, descriptor, distribution });
  const mayChange = useDistributionPermission(plugin, distribution, 'change');
  const guardHref = distribution.content_guard ?? null;
  const guards = useContentGuardNames(guardHref ? [guardHref] : []);
  // A distribution is public only when the server says it has no content
  // guard: a field that was not answered is never taken for none.
  const isPublic = distribution.content_guard === null;
  const url = kind.entity.clientUrlOf(distribution);
  const failed = serving.serves.state === 'error';

  return (
    <Details
      fields={[
        {
          label: t`Client URL`,
          value: (
            <>
              <DistributionURL
                distribution={{
                  url,
                  state:
                    serving.served.value ??
                    ({ state: 'served', fix: null } as const),
                }}
              />
              {isPublic ? (
                <PublicLabel />
              ) : (
                <Content component='small'>
                  {t`Downloads need credentials. A browser does not send your session to the content server, so this address cannot be opened there.`}
                </Content>
              )}
            </>
          ),
        },
        { label: t`Base path`, value: distribution.base_path },
        {
          label: t`Serves`,
          value: (
            <>
              <ServesValue serves={serving.serves} plugin={plugin} />
              {failed ? (
                <>
                  {' '}
                  <Button variant='link' isInline onClick={serving.retry}>
                    {t`Retry`}
                  </Button>
                </>
              ) : null}
            </>
          ),
        },
        {
          label: t`Content guard`,
          value: (
            <GuardValue
              guard={{
                pending: guards.pending,
                href: guardHref,
                name: guardHref ? (guards.names.get(guardHref) ?? null) : null,
                kind: guardKindOf(guardHref),
              }}
              isPublic={isPublic}
            />
          ),
        },
        {
          label: t`Labels`,
          value: (
            <LabelEditor
              object={distribution}
              entity={kind.entity}
              canEdit={mayChange}
            />
          ),
        },
        {
          label: t`Created`,
          value: <DateComponent date={distribution.pulp_created ?? ''} />,
        },
      ]}
    />
  );
};

const DistributionDetailScreen = ({
  plugin,
  descriptor,
  name,
}: Props & { name?: string }) => {
  const entity = descriptor.distribution?.entity;

  if (!entity) {
    throw new Error(
      `The ${plugin} descriptor declares no distributions, which their detail needs`,
    );
  }

  // The alerts another screen queued for this one are taken over once, so they
  // show here and nowhere else.
  const { alerts, setAlerts, handOver } = useQueuedAlerts();
  const navigate = useNavigate();

  const query = useEntityByName(entity, name ?? null, {
    enabled: name !== undefined,
  });
  const distribution = query.data;

  const mayDelete = useDistributionPermission(plugin, distribution, 'delete');
  const [deleting, setDeleting] = useState(false);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // The distribution on screen is never replaced by the failure of a later
  // read: it stays, and the failure is reported next to it, once.
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
        title: t`Distribution could not be displayed.`,
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

  // The name is unique, so a read that found nothing is a distribution that
  // does not exist (or no longer under this name).
  if (name === undefined || (query.isSuccess && distribution === null)) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the distribution, with Pulp's own reason.
  if (!distribution && status === 403) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!distribution && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader
          title={name}
          breadcrumbs={
            <Breadcrumbs
              links={[
                { url: distributionListPath(), name: t`Distributions` },
                { name },
              ]}
            />
          }
        />
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

  const typeName = pluginLabel(plugin);

  return (
    <>
      {alertList}
      <BaseHeader
        title={distribution.name}
        subTitle={
          <Content component='p'>{t`${typeName} distribution`}</Content>
        }
        breadcrumbs={
          <Breadcrumbs
            links={[
              { url: distributionListPath(), name: t`Distributions` },
              { name: distribution.name },
            ]}
          />
        }
        pageControls={
          mayDelete ? (
            <Flex spaceItems={{ default: 'spaceItemsSm' }}>
              <FlexItem>
                <Button
                  variant='secondary'
                  isDanger
                  onClick={() => setDeleting(true)}
                >
                  {t`Delete`}
                </Button>
              </FlexItem>
            </Flex>
          ) : undefined
        }
      />
      {deleting ? (
        <DeleteDistributionDialog
          plugin={plugin}
          distribution={distribution}
          onClose={() => setDeleting(false)}
          onAccepted={(alert) => {
            // The delete is accepted and its task is followed from here on:
            // the list is where the user goes, and it shows the alert.
            handOver(alert);
            navigate(distributionListPath());
          }}
        />
      ) : null}
      <Main>
        <section className='pulp-section' data-cy='DistributionDetail-details'>
          <DistributionRows
            plugin={plugin}
            descriptor={descriptor}
            distribution={distribution}
          />
        </section>
      </Main>
    </>
  );
};
