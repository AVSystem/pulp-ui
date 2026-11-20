import { t } from '@lingui/core/macro';
import { Skeleton } from '@patternfly/react-core';
import { type ComponentProps } from 'react';
import { Link } from 'react-router';
import { DateComponent, StatusIndicator } from 'src/components';
import { taskUrlId } from 'src/entities/core/task/href';
import type { Task } from 'src/entities/core/task/model';
import { versionNumberOf } from 'src/entities/href';
import { Paths, formatPath } from 'src/paths';

// The cells of the columns a list fills from reads it shares between its rows:
// where a repository is served, its latest version, how much content that
// version holds and its last task. A cell holds no request. Its row passes in
// what the shared read says about this one repository, together with the state
// of that read, so a column that is still loading, failed or cannot be offered
// says so in every row instead of reading as "nothing there".

// How far the shared read behind a column has got. `unsupported` is a read the
// server cannot do at all, which the column says plainly.
export type ColumnState = 'loading' | 'ready' | 'error' | 'unsupported';

type TaskState = ComponentProps<typeof StatusIndicator>['status'];

const Placeholder = () => <Skeleton width='70%' />;

const NotLoaded = () => <>{t`Not loaded`}</>;

// The base URLs a repository is served at: the first one, and how many more
// there are.
export const BaseUrlCell = ({
  state,
  urls,
}: {
  state: ColumnState;
  urls: readonly string[] | undefined;
}) => {
  if (state === 'loading') {
    return <Placeholder />;
  }
  if (state !== 'ready') {
    return <NotLoaded />;
  }
  if (!urls || urls.length === 0) {
    return <>{t`Not served`}</>;
  }

  const more = urls.length - 1;

  return (
    <span title={urls.join('\n')}>
      {urls[0]}
      {more > 0 ? ` ${t`+${more} more`}` : ''}
    </span>
  );
};

// The number of the repository's latest version, read from the address of the
// version.
export const VersionCell = ({ href }: { href: string | null | undefined }) => {
  const number = versionNumberOf(href);

  return <>{number === null ? t`None` : String(number)}</>;
};

// How much content the latest version holds. `count` is what the shared read of
// the version summaries holds for this version: a number, null for a version
// whose answer carries no summary, undefined while it is not read.
export const ContentCountCell = ({
  state,
  count,
  hasVersion,
}: {
  state: ColumnState;
  count: number | null | undefined;
  hasVersion: boolean;
}) => {
  if (!hasVersion) {
    return <>{t`None`}</>;
  }
  if (typeof count === 'number') {
    return <>{String(count)}</>;
  }
  if (count === null || state === 'unsupported') {
    return <>{t`Not available`}</>;
  }
  if (state === 'loading') {
    return <Placeholder />;
  }

  return state === 'error' ? <NotLoaded /> : <>{t`Not available`}</>;
};

// The state of the newest task that reserved the repository, with a link to the
// task, and when it was made. A repository no recent task names says so; it is
// never "never synced", because the shared read only holds recent tasks.
export const LastTaskCell = ({
  state,
  task,
}: {
  state: ColumnState;
  task: Task | null;
}) => {
  if (task) {
    const indicator = <StatusIndicator status={task.state as TaskState} />;
    // A task whose address is not a task address has no page to link to.
    const linked = taskUrlId(task.pulp_href) !== null;

    return (
      <>
        {linked ? (
          <Link
            to={formatPath(Paths.core.task.detail, {
              task: taskUrlId(task.pulp_href),
            })}
          >
            {indicator}
          </Link>
        ) : (
          indicator
        )}{' '}
        <DateComponent
          date={task.finished_at ?? task.started_at ?? task.pulp_created ?? ''}
        />
      </>
    );
  }
  if (state === 'loading') {
    return <Placeholder />;
  }

  return state === 'ready' ? <>{t`No recent task`}</> : <NotLoaded />;
};
