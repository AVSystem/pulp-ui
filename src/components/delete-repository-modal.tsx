import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  Alert,
  FormGroup,
  Label,
  List,
  ListItem,
  Spinner,
  Text,
  TextInput,
} from '@patternfly/react-core';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Paths, formatPath } from 'src/paths';
import { ContentGuardAPI } from '../api/content-guard';
import { type DeleteRepositoryResult } from '../utilities/delete-repository';
import { listAll } from '../utilities/list-all';
import { parsePulpIDFromURL } from '../utilities/parse-pulp-id';
import {
  type RepositoryDistribution,
  type RepositoryDistributionPlugin,
  distributionsLoadError,
  repositoryDistributions,
} from '../utilities/repository-distributions';
import { DeleteModal } from './delete-modal';
import { DistributionURL } from './distribution-url';

interface IProps {
  closeAction: () => void;
  // Resolves with what was removed, rejects when the distributions could not
  // be listed (nothing was deleted then). The caller closes the dialog when the
  // repository is gone; a repository that was kept stays on screen here.
  deleteAction: () => Promise<DeleteRepositoryResult>;
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
  } catch {
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

// What happened when the repository was kept: what was removed, what was not
// and why, and what is still being removed.
const KeptReport = ({ result }: { result: DeleteRepositoryResult }) => (
  <Alert
    isInline
    title={
      result.failed.length || result.pending.length || result.unknown.length
        ? t`The repository was kept because not every distribution was removed.`
        : t`The distributions were removed but the repository was kept.`
    }
    variant='danger'
  >
    {result.removed.length ? (
      <>
        <Text>
          <strong>{t`Removed`}</strong>
        </Text>
        <List>
          {result.removed.map((name) => (
            <ListItem key={name}>{name}</ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.failed.length ? (
      <>
        <Text>
          <strong>{t`Not removed`}</strong>
        </Text>
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
        <Text>
          <strong>{t`Still being removed`}</strong>
        </Text>
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
        <Text>
          <strong>{t`Outcome unknown, check the task`}</strong>
        </Text>
        <List>
          {result.unknown.map(({ name, taskHref }) => (
            <ListItem key={name}>
              {name} - <Link to={taskLink(taskHref)}>{t`task`}</Link>
            </ListItem>
          ))}
        </List>
      </>
    ) : null}
    {result.repositoryError ? (
      <Text>{t`The repository could not be removed: ${result.repositoryError}`}</Text>
    ) : null}
    {result.repositoryPending ? (
      <Text>
        {t`The repository is still being removed:`}{' '}
        <Link to={taskLink(result.repositoryPending)}>{t`task`}</Link>
      </Text>
    ) : null}
    {result.repositoryUnknown ? (
      <Text>
        {t`The outcome of removing the repository is unknown. Check the task:`}{' '}
        <Link to={taskLink(result.repositoryUnknown)}>{t`task`}</Link>
      </Text>
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
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    repositoryDistributions(plugin, pulpHref, { complete: true })
      .then(async (distributions) => ({
        distributions,
        guardNames: await guardNamesOf(distributions),
      }))
      .then(
        (loaded) => !cancelled && setListing({ status: 'ready', ...loaded }),
        (e) =>
          !cancelled &&
          setListing({ status: 'error', message: distributionsLoadError(e) }),
      );

    return () => {
      cancelled = true;
    };
  }, [plugin, pulpHref]);

  if (!name) {
    return null;
  }

  const confirm = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteAction();
      setKept(result.repositoryDeleted ? null : result);
    } catch (e) {
      setDeleteError(distributionsLoadError(e));
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
      <Text>
        <Trans>
          Are you sure you want to delete the repository <b>{name}</b>?
        </Trans>
      </Text>

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
            <Text>
              {t`These distributions serve the repository. They are deleted with it, and their URLs stop working:`}
            </Text>
            <DistributionList
              distributions={listing.distributions}
              guardNames={listing.guardNames}
            />
          </>
        ) : (
          <Text>
            {t`No distribution serves this repository. Only the repository is deleted.`}
          </Text>
        )
      ) : null}

      {deleteError ? (
        <Alert
          isInline
          title={t`The distributions of this repository could not be listed, so nothing was deleted.`}
          variant='danger'
        >
          {deleteError}
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
