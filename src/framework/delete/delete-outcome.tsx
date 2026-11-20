import { t } from '@lingui/core/macro';
import { Content, List, ListItem } from '@patternfly/react-core';
import { Link } from 'react-router';
import type { AlertType } from 'src/components';
import { taskUrlId } from 'src/entities/core/task/href';
import { Paths, formatPath } from 'src/paths';
import type { DeleteRepositoryResult } from './delete-repository';

// What a delete of a repository came to, in words a screen shows: as the
// report of a dialog that stays open, or as the alert the next screen shows
// when the delete outlived the one it started from.

const taskLink = (taskHref: string) =>
  formatPath(Paths.core.task.detail, { task: taskUrlId(taskHref) });

// Whether the session ended before the delete was finished.
const sessionStopped = (result: DeleteRepositoryResult) =>
  result.unconfirmed.length > 0 ||
  result.notSent.length > 0 ||
  result.repositoryUnconfirmed;

// The title says what is true: the session ended, some distributions were not
// removed, the repository's own removal is not confirmed yet (its task is still
// running or its status could not be read, so the repository may be gone), all
// distributions were removed, or none was involved at all.
export function keptTitle(result: DeleteRepositoryResult): string {
  if (
    result.failed.length ||
    result.pending.length ||
    result.unknown.length ||
    result.unlisted.length
  ) {
    return t`The repository was kept because not every distribution was removed.`;
  }
  if (sessionStopped(result)) {
    return t`The session ended before the delete was finished.`;
  }
  if (result.repositoryPending || result.repositoryUnknown) {
    return t`The removal of the repository has not been confirmed.`;
  }
  if (result.removed.length) {
    return t`The distributions were removed but the repository was kept.`;
  }
  return t`The repository was not removed.`;
}

const Names = ({ title, names }: { title: string; names: string[] }) =>
  names.length ? (
    <>
      <Content component='p'>
        <strong>{title}</strong>
      </Content>
      <List>
        {names.map((name) => (
          <ListItem key={name}>{name}</ListItem>
        ))}
      </List>
    </>
  ) : null;

const WithTasks = ({
  title,
  rows,
}: {
  title: string;
  rows: { name: string; taskHref: string }[];
}) =>
  rows.length ? (
    <>
      <Content component='p'>
        <strong>{title}</strong>
      </Content>
      <List>
        {rows.map(({ name, taskHref }) => (
          <ListItem key={name}>
            {name} - <Link to={taskLink(taskHref)}>{t`task`}</Link>
          </ListItem>
        ))}
      </List>
    </>
  ) : null;

// What happened when the repository was kept: what was removed, what was not
// and why, and what is still being removed.
export const OutcomeReport = ({
  result,
}: {
  result: DeleteRepositoryResult;
}) => (
  <>
    <Names title={t`Removed`} names={result.removed} />
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
    <WithTasks title={t`Still being removed`} rows={result.pending} />
    <WithTasks
      title={t`Outcome unknown, check the task`}
      rows={result.unknown}
    />
    <Names
      title={t`Not removed, not shown when this dialog opened`}
      names={result.unlisted}
    />
    <Names title={t`Not confirmed`} names={result.unconfirmed} />
    <Names title={t`Not sent`} names={result.notSent} />
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
    {result.repositoryUnconfirmed ? (
      <Content component='p'>
        {t`It is not known whether the repository was removed.`}
      </Content>
    ) : null}
  </>
);

// Names the repository an alert is about, for an alert that is shown on a
// screen that is not the repository's own.
export const RepositoryName = ({ name }: { name: string }) => (
  <Content component='p'>{t`Repository: ${name}`}</Content>
);

// The alert that carries the result to the screen the user is on once the one
// the delete started from is gone: the repository removed, or the repository
// kept with what happened to each distribution.
export function outcomeAlert(
  name: string,
  result: DeleteRepositoryResult,
): AlertType {
  if (result.repositoryDeleted) {
    return {
      variant: 'success',
      title: t`Removed repository ${name}`,
      description: result.removed.length
        ? t`Removed distributions: ${result.removed.join(', ')}`
        : undefined,
    };
  }

  return {
    variant:
      result.repositoryPending ||
      result.repositoryUnknown ||
      sessionStopped(result)
        ? 'warning'
        : 'danger',
    title: keptTitle(result),
    description: (
      <>
        <RepositoryName name={name} />
        <OutcomeReport result={result} />
      </>
    ),
  };
}
