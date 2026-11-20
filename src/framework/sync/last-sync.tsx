import { t } from '@lingui/core/macro';
import { Button, Skeleton } from '@patternfly/react-core';
import { Link } from 'react-router';
import { DateComponent, TaskStateLabel } from 'src/components';
import { taskUrlId } from 'src/entities/core/task/href';
import { useLastSyncOf } from 'src/entities/core/task/task-index';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { Paths, formatPath } from 'src/paths';
import { isSessionEnd } from 'src/utilities/request-error';
import type { PluginDescriptor } from '../descriptor';

interface Props {
  repository: RepositoryBase;
  descriptor: PluginDescriptor;
}

// The last sync of a repository: when it ended (or started, or was queued, for
// one that has not ended), how it stands, and the link to its task. A
// repository no sync task names was never synced. A repository without a remote
// has nothing to sync from, and the row says so instead of leaving the missing
// Sync button unexplained. A read that failed says so and can be asked again,
// so a missing line is never mistaken for a repository that was never synced.
export const LastSync = ({ repository, descriptor }: Props) => {
  const taskName = descriptor.repository.sync?.taskName ?? null;
  const last = useLastSyncOf(repository.pulp_href, taskName);
  const task = last.data;

  let found;
  if (last.isError && !isSessionEnd(last.error)) {
    found = (
      <>
        <span
          style={{
            color: 'var(--pf-t--global--text--color--status--danger--default)',
          }}
        >
          {t`The last sync could not be read.`}
        </span>{' '}
        <Button variant='link' isInline onClick={() => last.refetch()}>
          {t`Retry`}
        </Button>
      </>
    );
  } else if (task === undefined) {
    found = <Skeleton width='60%' />;
  } else if (task === null) {
    found = <>{t`Never synced`}</>;
  } else {
    const linked = taskUrlId(task.pulp_href) !== null;

    found = (
      <>
        <DateComponent
          date={task.finished_at ?? task.started_at ?? task.pulp_created ?? ''}
        />{' '}
        <TaskStateLabel state={task.state} />
        {linked ? (
          <>
            {' '}
            <Link
              to={formatPath(Paths.core.task.detail, {
                task: taskUrlId(task.pulp_href),
              })}
            >
              {t`View the task`}
            </Link>
          </>
        ) : null}
      </>
    );
  }

  return (
    <>
      <div>{found}</div>
      {repository.remote ? null : (
        <div>{t`Sync is unavailable because this repository has no remote.`}</div>
      )}
    </>
  );
};
