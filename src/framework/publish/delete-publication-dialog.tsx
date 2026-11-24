import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  AlertActionLink,
  Content,
  List,
  ListItem,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Alert, Spinner } from 'src/components';
import { DeleteModal } from 'src/components/delete-modal';
import { distributionPageKeys } from 'src/entities/core/distribution/queries';
import { publicationRefKeys } from 'src/entities/core/publication/queries';
import { versionNumberOf } from 'src/entities/href';
import {
  type DistributionBase,
  useDistributionIndex,
} from 'src/entities/plugin/distribution';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { useRepositoryPublications } from 'src/entities/plugin/publication';
import { entityKeys } from 'src/entities/plugin/queries';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import type {
  DistributionKind,
  PluginDescriptor,
  PublicationKind,
} from '../descriptor';
import type { FrameworkPlugin } from '../manifest';
import { distributionPath } from '../route-patterns';
import {
  type AfterDelete,
  type PublicationRow,
  consequencesOfDelete,
} from './publication-consequences';

interface Props {
  plugin: FrameworkPlugin;
  descriptor: PluginDescriptor;
  repository: RepositoryBase;
  publication: PublicationRow;
  onClose: () => void;
  // Called once the publication is gone, while the dialog is still open.
  onDeleted: (publication: PublicationRow) => void;
}

// What a distribution serves once the publication is gone, in words.
const outcomeText = (after: AfterDelete) =>
  after.kind === 'nothing'
    ? t`will serve nothing (404)`
    : t`will serve version ${after.version}`;

// Confirms the removal of one publication and says what it does to the
// distributions that serve it, because the server deletes a served publication
// without any protection: a distribution bound to that publication, or to a
// repository or version with no other publication, answers 404 afterwards, and
// one bound to a repository falls back to an older version. The distributions
// come from the index every screen shares and the publications from the one
// read of the repository's publications, so the dialog adds no read of its own
// when the tab is open. Pulp answers 204 at once: there is no task to follow;
// the screens that read publications and distributions are read again.
export const DeletePublicationDialog = (props: Props) => {
  const { publication, distribution } = props.descriptor;

  return publication?.entity.remove && distribution ? (
    <DeleteDialog
      {...props}
      kind={publication}
      distribution={distribution}
      remove={publication.entity.remove}
    />
  ) : null;
};

const DeleteDialog = ({
  plugin,
  repository,
  publication,
  onClose,
  onDeleted,
  kind,
  distribution,
  remove,
}: Props & {
  kind: PublicationKind;
  distribution: DistributionKind<DistributionBase>;
  remove: (href: string) => Promise<void>;
}) => {
  const queryClient = useQueryClient();
  const index = useDistributionIndex(distribution.entity, kind.entity);
  const all = useRepositoryPublications(kind.entity, repository.pulp_href);
  const { distributionsOfRepository } = index;
  const affected = useMemo(() => {
    const own = distributionsOfRepository(repository.pulp_href);
    return own && all.data
      ? consequencesOfDelete(publication, all.data, own)
      : null;
  }, [distributionsOfRepository, repository.pulp_href, all.data, publication]);

  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<{ message: ReactNode | null } | null>(
    null,
  );
  // Pressing Delete twice must send one request.
  const running = useRef(false);
  const version = versionNumberOf(publication.repository_version);

  const loadFailed = index.status === 'error' || all.status === 'error';
  const confirm = async () => {
    if (running.current || affected === null) {
      return;
    }
    running.current = true;
    setDeleting(true);
    setFailure(null);
    try {
      await remove(publication.pulp_href);
      void queryClient.invalidateQueries({ queryKey: publicationRefKeys.all });
      void queryClient.invalidateQueries({
        queryKey: entityKeys(kind.entity).all,
      });
      void queryClient.invalidateQueries({
        queryKey: entityKeys(distribution.entity).all,
      });
      void queryClient.invalidateQueries({
        queryKey: distributionPageKeys.all,
      });
      // The publication is gone for good: the guard stays set so a press after
      // the answer cannot send a second delete.
      onDeleted(publication);
    } catch (error) {
      running.current = false;
      setFailure({
        message: isSessionEnd(error) ? null : requestErrorDescription(error),
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DeleteModal
      spinner={deleting}
      cancelAction={onClose}
      deleteAction={confirm}
      isCancelDisabled={deleting}
      isDisabled={deleting || affected === null}
      title={t`Delete publication?`}
      variant='medium'
    >
      <Content component='p'>
        {version === null ? (
          t`Are you sure you want to delete this publication?`
        ) : (
          <Trans>
            Are you sure you want to delete the publication of version{' '}
            <b>{version}</b>?
          </Trans>
        )}
      </Content>

      {affected === null && !loadFailed ? (
        <Spinner size='md' aria-label={t`Loading distributions`} />
      ) : null}

      {loadFailed && affected === null ? (
        <Alert
          isInline
          title={t`The distributions of this repository could not be listed, so the effect of the delete is not known.`}
          variant='danger'
          actionLinks={
            <AlertActionLink
              onClick={() => {
                index.retry();
                void all.refetch();
              }}
            >{t`Retry`}</AlertActionLink>
          }
        >
          {requestErrorDescription(index.error ?? all.error)}
        </Alert>
      ) : null}

      {affected !== null && affected.length > 0 ? (
        <>
          <Content component='p'>
            {t`These distributions serve this publication. Deleting it changes what they serve:`}
          </Content>
          <List isPlain>
            {affected.map(({ distribution: row, after }) => (
              <ListItem key={row.pulp_href}>
                <strong>
                  <Link to={distributionPath(plugin, row.name)}>
                    {row.name}
                  </Link>
                </strong>{' '}
                <span>{outcomeText(after)}</span>
              </ListItem>
            ))}
          </List>
        </>
      ) : null}

      {affected !== null && affected.length === 0 ? (
        <Content component='p'>
          {t`No distribution serves this publication.`}
        </Content>
      ) : null}

      {failure ? (
        <Alert
          isInline
          title={t`The publication could not be deleted.`}
          variant='danger'
        >
          {failure.message}
        </Alert>
      ) : null}
    </DeleteModal>
  );
};
