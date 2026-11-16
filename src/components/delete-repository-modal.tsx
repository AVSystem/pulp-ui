import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  Content,
  FormGroup,
  Label,
  List,
  ListItem,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Paths, formatPath } from 'src/paths';
import { useSessionEpoch } from 'src/user-context';
import { ContentGuardAPI } from '../api/content-guard';
import {
  DeleteNotStarted,
  type DeleteRepositoryResult,
} from '../utilities/delete-repository';
import { listAll } from '../utilities/list-all';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import {
  type RepositoryDistribution,
  type RepositoryDistributionPlugin,
  distributionsLoadError,
  repositoryDistributions,
} from '../utilities/repository-distributions';
import { isSessionEnd } from '../utilities/request-error';
import { DeleteModal } from './delete-modal';
import { DistributionURL } from './distribution-url';
import { Alert, Spinner } from './patternfly-wrappers/l10n';

interface IProps {
  closeAction: () => void;
  // Resolves with what was removed, rejects with DeleteNotStarted when the
  // distributions could not be listed (nothing was deleted then). Any other
  // rejection is an unexpected error that may have come after deletes. The caller closes the dialog when the
  // repository is gone; a repository that was kept stays on screen here.
  // `shown` is the listing the dialog displayed; exactly these are deleted.
  deleteAction: (
    shown: RepositoryDistribution[],
  ) => Promise<DeleteRepositoryResult>;
  name: string;
  plugin: RepositoryDistributionPlugin;
  pulpHref: string;
}

type Listing =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'ready';
      distributions: RepositoryDistribution[];
      // content guard names by href; a guard the user may not see has none
      guardNames: Record<string, string>;
    };

// The names of the content guards, in one request. A user who may not see the
// guards gets none, and the distributions are then marked as guarded without a
// name.
async function guardNamesOf(
  distributions: RepositoryDistribution[],
): Promise<Record<string, string>> {
  const hrefs = Array.from(
    new Set(distributions.map(({ content_guard }) => content_guard)),
  ).filter(Boolean);

  if (!hrefs.length) {
    return {};
  }

  try {
    const guards = await listAll<{ pulp_href: string; name: string }>(
      (params) => ContentGuardAPI.list(params),
      { pulp_href__in: hrefs.join(','), fields: 'pulp_href,name' },
    );
    return Object.fromEntries(
      guards.map(({ pulp_href, name }) => [pulp_href, name]),
    );
  } catch (e) {
    // A refused read for a user who may not see the guards leaves the names
    // out. A read that failed only because the session ended is not that: the
    // whole listing is read again after signing in, with the names.
    if (isSessionEnd(e)) {
      throw e;
    }
    return {};
  }
}

const taskLink = (taskHref: string) =>
  formatPath(Paths.core.task.detail, { task: parsePulpIDFromURL(taskHref) });

const DistributionList = ({
  distributions,
  guardNames,
}: {
  distributions: RepositoryDistribution[];
  guardNames: Record<string, string>;
}) => (
  <List isPlain>
    {distributions.map((distribution) => {
      const guardName = guardNames[distribution.content_guard];
      return (
        <ListItem key={distribution.pulp_href}>
          <strong>{distribution.name}</strong>
          <DistributionURL distribution={distribution} />
          {distribution.content_guard ? (
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

// The title says what is true of the distributions: some were not removed, all
// of them were removed, or none was involved at all.
function keptTitle(result: DeleteRepositoryResult): string {
  if (
    result.failed.length ||
    result.pending.length ||
    result.unknown.length ||
    result.unlisted.length
  ) {
    return t`The repository was kept because not every distribution was removed.`;
  }
  if (result.removed.length) {
    return t`The distributions were removed but the repository was kept.`;
  }
  return t`The repository was not removed.`;
}

// What happened when the repository was kept: what was removed, what was not
// and why, and what is still being removed.
const KeptReport = ({ result }: { result: DeleteRepositoryResult }) => (
  <Alert isInline title={keptTitle(result)} variant='danger'>
    {result.removed.length ? (
      <>
        <Content component='p'>
          <strong>{t`Removed`}</strong>
        </Content>
        <List>
          {result.removed.map((name) => (
            <ListItem key={name}>{name}</ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.failed.length ? (
      <>
        <Content component='p'>
          <strong>{t`Not removed`}</strong>
        </Content>
        <List>
          {result.failed.map(({ name, reason }) => (
            <ListItem key={name}>
              {name}: {reason}
            </ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.pending.length ? (
      <>
        <Content component='p'>
          <strong>{t`Still being removed`}</strong>
        </Content>
        <List>
          {result.pending.map(({ name, taskHref }) => (
            <ListItem key={name}>
              {name} - <Link to={taskLink(taskHref)}>{t`task`}</Link>
            </ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.unknown.length ? (
      <>
        <Content component='p'>
          <strong>{t`Outcome unknown, check the task`}</strong>
        </Content>
        <List>
          {result.unknown.map(({ name, taskHref }) => (
            <ListItem key={name}>
              {name} - <Link to={taskLink(taskHref)}>{t`task`}</Link>
            </ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.unlisted.length ? (
      <>
        <Content component='p'>
          <strong>{t`Not removed, not shown when this dialog opened`}</strong>
        </Content>
        <List>
          {result.unlisted.map((name) => (
            <ListItem key={name}>{name}</ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.repositoryError ? (
      <Content component='p'>{t`The repository could not be removed: ${result.repositoryError}`}</Content>
    ) : null}
    {result.repositoryPending ? (
      <Content component='p'>
        {t`The repository is still being removed:`}{' '}
        <Link to={taskLink(result.repositoryPending)}>{t`task`}</Link>
      </Content>
    ) : null}
    {result.repositoryUnknown ? (
      <Content component='p'>
        {t`The outcome of removing the repository is unknown. Check the task:`}{' '}
        <Link to={taskLink(result.repositoryUnknown)}>{t`task`}</Link>
      </Content>
    ) : null}
  </Alert>
);

export const DeleteRepositoryModal = ({
  closeAction,
  deleteAction,
  name,
  plugin,
  pulpHref,
}: IProps) => {
  const [listing, setListing] = useState<Listing>({ status: 'loading' });
  const [deleting, setDeleting] = useState(false);
  const [typedName, setTypedName] = useState('');
  const [kept, setKept] = useState<DeleteRepositoryResult | null>(null);
  const [deleteError, setDeleteError] = useState<{
    message: string;
    nothingDeleted: boolean;
  } | null>(null);

  // grows when the same user signs in again, so the distributions are listed again
  const epoch = useSessionEpoch();
  const listedEpoch = useRef(epoch);
  // Once a delete has started or finished, the listing on screen is the one
  // that was passed to it and a later read must not replace it.
  const frozen = useRef(false);
  frozen.current = deleting || kept !== null;

  useEffect(() => {
    let cancelled = false;

    // A listing read again for a new session keeps the list on screen, and a
    // listing that failed starts over like a first read.
    const again = listedEpoch.current !== epoch;
    listedEpoch.current = epoch;
    if (again && frozen.current) {
      return;
    }
    setListing((shown) =>
      shown.status !== 'loading' && (!again || shown.status === 'error')
        ? { status: 'loading' }
        : shown,
    );

    repositoryDistributions(plugin, pulpHref, { complete: true })
      .then(async (distributions) => ({
        distributions,
        guardNames: await guardNamesOf(distributions),
      }))
      .then(
        (loaded) =>
          !cancelled &&
          !frozen.current &&
          setListing({ status: 'ready', ...loaded }),
        (e) =>
          // The session ended: the sign-in dialog explains it, and the dialog
          // keeps its list or its spinner until the read runs again.
          !cancelled &&
          !isSessionEnd(e) &&
          setListing({ status: 'error', message: distributionsLoadError(e) }),
      );

    return () => {
      cancelled = true;
    };
  }, [plugin, pulpHref, epoch]);

  if (!name) {
    return null;
  }

  const confirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAction(
        listing.status === 'ready' ? listing.distributions : [],
      );
      setKept(result.repositoryDeleted ? null : result);
    } catch (e) {
      setDeleteError(
        e instanceof DeleteNotStarted
          ? { message: distributionsLoadError(e.cause), nothingDeleted: true }
          : { message: distributionsLoadError(e), nothingDeleted: false },
      );
    } finally {
      setDeleting(false);
    }
  };

  return (
    <DeleteModal
      spinner={deleting}
      cancelAction={closeAction}
      deleteAction={confirm}
      isCancelDisabled={deleting}
      isDisabled={
        deleting ||
        listing.status !== 'ready' ||
        kept !== null ||
        typedName !== name
      }
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
            <DistributionList
              distributions={listing.distributions}
              guardNames={listing.guardNames}
            />
          </>
        ) : (
          <Content component='p'>
            {t`No distribution serves this repository. Only the repository is deleted.`}
          </Content>
        )
      ) : null}

      {deleteError ? (
        <Alert
          isInline
          title={
            deleteError.nothingDeleted
              ? t`The distributions of this repository could not be listed, so nothing was deleted.`
              : t`The delete stopped with an unexpected error. Some distributions or the repository may already have been removed: check the lists before trying again.`
          }
          variant='danger'
        >
          {deleteError.message}
        </Alert>
      ) : null}

      {kept ? <KeptReport result={kept} /> : null}

      {kept ? null : (
        <FormGroup
          fieldId='delete-repository-name'
          label={t`Type the repository name to confirm`}
        >
          <TextInput
            id='delete-repository-name'
            isDisabled={deleting}
            onChange={(_event, value) => setTypedName(value)}
            type='text'
            value={typedName}
          />
        </FormGroup>
      )}
    </DeleteModal>
  );
};
