import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  AlertActionLink,
  Content,
  Label,
  List,
  ListItem,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useAppContext } from 'src/app-context';
import { Alert, type AlertType, Spinner } from 'src/components';
import { DeleteModal } from 'src/components/delete-modal';
import { DistributionURL } from 'src/components/distribution-url';
import { useContentGuardNames } from 'src/entities/core/content-guard/queries';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { entityKeys } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import { type PluginDescriptor, repositoryOf } from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import {
  type ServedDistribution,
  useServedDistributions,
} from '../serving/use-served-distributions';
import {
  OutcomeReport,
  RepositoryName,
  keptTitle,
  outcomeAlert,
} from './delete-outcome';
import {
  DeleteNotStarted,
  type DeleteRepositoryResult,
  deleteRepositoryWithDistributions,
} from './delete-repository';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  onClose: () => void;
  // Called once the repository is gone, with the alert that says so, and only
  // while the screen the dialog belongs to is still shown. A delete that
  // outlives its screen calls nothing: the screen is not where the user is
  // now, so the alert is queued for the next one and nothing navigates or
  // reloads.
  onDeleted: (alert: AlertType) => void;
}

// What the dialog knows about the distributions that go with the repository.
type Listing =
  | { status: 'loading' }
  | { status: 'error'; message: ReactNode | null; retry: () => void }
  | { status: 'ready'; distributions: ServedDistribution[] };

const byName = (a: ServedDistribution, b: ServedDistribution) =>
  a.row.name.localeCompare(b.row.name);

// The distributions with their URL and, for a distribution protected by a
// content guard, a warning that its URL is customer-facing, with the guard's
// name when it can be read.
const DistributionList = ({
  distributions,
}: {
  distributions: ServedDistribution[];
}) => {
  const { names } = useContentGuardNames(
    distributions.flatMap(({ row }) =>
      row.content_guard ? [row.content_guard] : [],
    ),
  );

  return (
    <List isPlain>
      {distributions.map(({ row, served }) => {
        const guardName = row.content_guard
          ? names.get(row.content_guard)
          : undefined;
        return (
          <ListItem key={row.pulp_href}>
            <strong>{row.name}</strong>
            <DistributionURL
              distribution={{ url: row.base_url ?? null, state: served }}
            />
            {row.content_guard ? (
              <>
                <Label color='red'>
                  {t`Protected by a content guard: customer-facing URL`}
                </Label>
                {guardName ? <> {t`Guard: ${guardName}`}</> : null}
              </>
            ) : null}
          </ListItem>
        );
      })}
    </List>
  );
};

// Confirms the removal of a repository and of the distributions that serve it,
// then removes them: the distributions first (at most four at once), the
// repository only once every one of them is gone. The distributions are listed
// from the index of the plugin's distributions and read again from the server
// when the delete starts; exactly the ones shown are deleted, and one that
// appeared since is reported and keeps the repository.
//
// The dialog stays open while the delete runs and cannot be closed. When the
// repository is gone the screen that opened the dialog is told; when it is
// kept, the dialog says what happened to each distribution. The delete does not
// depend on the screen: if the user leaves while it runs, it goes on and its
// result is queued for the screen they are on.
export const DeleteRepositoryDialog = (props: Props) => {
  const { distribution, publication } = props.descriptor;

  return distribution ? (
    <WithDistributions
      {...props}
      distribution={distribution.entity}
      publication={publication}
    />
  ) : (
    <DeleteDialog {...props} listing={{ status: 'ready', distributions: [] }} />
  );
};

const WithDistributions = ({
  distribution,
  publication,
  ...props
}: Props & {
  distribution: NonNullable<PluginDescriptor['distribution']>['entity'];
  publication: PluginDescriptor['publication'];
}) => {
  const serving = useServedDistributions({
    plugin: props.plugin,
    distribution,
    publication,
    repository: props.repository,
  });

  let listing: Listing;
  if (serving.status === 'error') {
    listing = {
      status: 'error',
      message: isSessionEnd(serving.error)
        ? null
        : requestErrorDescription(serving.error),
      retry: serving.retry,
    };
  } else if (serving.distributions) {
    listing = {
      status: 'ready',
      distributions: [...serving.distributions].sort(byName),
    };
  } else {
    listing = { status: 'loading' };
  }

  return <DeleteDialog {...props} listing={listing} />;
};

const DeleteDialog = ({
  descriptor,
  repository,
  onClose,
  onDeleted,
  listing: live,
}: Props & { listing: Listing }) => {
  const { name, pulp_href } = repository;
  const { queueAlert } = useAppContext();
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(false);
  // The listing the delete was started with: what was confirmed is what stays
  // on screen, however the reads behind it change as the objects go.
  const [confirmed, setConfirmed] = useState<Listing | null>(null);
  const [kept, setKept] = useState<DeleteRepositoryResult | null>(null);
  const [failure, setFailure] = useState<{
    message: ReactNode | null;
    nothingDeleted: boolean;
  } | null>(null);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const listing = confirmed ?? live;

  // What was read of the plugin's objects is stale as soon as anything was
  // sent, whatever the delete came to.
  const reread = () => {
    void queryClient.invalidateQueries({
      queryKey: entityKeys(repositoryOf(descriptor).entity).all,
    });
    if (descriptor.distribution) {
      void queryClient.invalidateQueries({
        queryKey: entityKeys(descriptor.distribution.entity).all,
      });
    }
  };

  const confirm = async () => {
    if (running.current || listing.status !== 'ready') {
      return;
    }
    running.current = true;
    setConfirmed(listing);
    setDeleting(true);
    setFailure(null);

    try {
      const result = await deleteRepositoryWithDistributions({
        repository: repositoryOf(descriptor).entity,
        distribution: descriptor.distribution?.entity,
        publication: descriptor.publication,
        target: { name, pulp_href },
        shown: listing.distributions.map(({ row }) => row),
      });
      reread();

      const alert = outcomeAlert(name, result);
      if (!mounted.current) {
        queueAlert(alert);
      } else if (result.repositoryDeleted) {
        onDeleted(alert);
      } else {
        setKept(result);
      }
    } catch (error) {
      const nothingDeleted = error instanceof DeleteNotStarted;
      const cause = nothingDeleted ? error.cause : error;
      if (!nothingDeleted) {
        reread();
      }
      if (mounted.current) {
        setFailure({
          message: isSessionEnd(cause) ? null : requestErrorDescription(cause),
          nothingDeleted,
        });
        // Nothing was sent: what was shown can be read again.
        if (nothingDeleted) {
          setConfirmed(null);
        }
      } else {
        queueAlert({
          variant: 'danger',
          title: t`The delete stopped with an unexpected error. Some distributions or the repository may already have been removed: check the lists before trying again.`,
          description: (
            <>
              <RepositoryName name={name} />
              {isSessionEnd(cause) ? null : requestErrorDescription(cause)}
            </>
          ),
        });
      }
    } finally {
      running.current = false;
      if (mounted.current) {
        setDeleting(false);
      }
    }
  };

  return (
    <DeleteModal
      spinner={deleting}
      cancelAction={onClose}
      deleteAction={confirm}
      isCancelDisabled={deleting}
      isDisabled={deleting || listing.status !== 'ready' || kept !== null}
      title={t`Delete repository?`}
      variant='medium'
    >
      <Content component='p'>
        <Trans>
          Are you sure you want to delete the repository <b>{name}</b>?
        </Trans>
      </Content>

      {listing.status === 'loading' ? (
        <Spinner size='md' aria-label={t`Loading distributions`} />
      ) : null}

      {listing.status === 'error' ? (
        <Alert
          isInline
          title={t`The distributions of this repository could not be listed, so nothing can be deleted.`}
          variant='danger'
          actionLinks={
            <AlertActionLink
              onClick={listing.retry}
            >{t`Retry`}</AlertActionLink>
          }
        >
          {listing.message}
        </Alert>
      ) : null}

      {listing.status === 'ready' && !kept ? (
        listing.distributions.length ? (
          <>
            <Content component='p'>
              {t`These distributions serve the repository. They are deleted with it, and their URLs stop working:`}
            </Content>
            <DistributionList distributions={listing.distributions} />
          </>
        ) : (
          <Content component='p'>
            {t`No distribution serves this repository. Only the repository is deleted.`}
          </Content>
        )
      ) : null}

      {failure ? (
        <Alert
          isInline
          title={
            failure.nothingDeleted
              ? t`The distributions of this repository could not be listed, so nothing was deleted.`
              : t`The delete stopped with an unexpected error. Some distributions or the repository may already have been removed: check the lists before trying again.`
          }
          variant='danger'
        >
          {failure.message}
        </Alert>
      ) : null}

      {kept ? (
        <Alert isInline title={keptTitle(kept)} variant='danger'>
          <OutcomeReport result={kept} />
        </Alert>
      ) : null}
    </DeleteModal>
  );
};
