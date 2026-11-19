import { plural } from '@lingui/core/macro';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { taskKeys, useTaskCount } from 'src/entities/core/task/queries';
import { Paths, formatPath } from 'src/paths';
import { isSessionEnd } from 'src/utilities/request-error';

// How often the counts are asked for again while the page is in view.
export const COUNT_REFRESH_MS = 60_000;

// How far back a failed task still counts as a recent failure.
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

// The most a pill shows as a number; more reads as "99+".
const PILL_CAP = 99;

// The number of tasks in one state: a number once the server answered, null
// before that and after a request that failed or was refused.
type Count = number | null;

interface ITaskCounts {
  running: Count;
  failed: Count;
}

const RUNNING = { state: 'running' };
const FAILED = { state: 'failed', finishedWithinMs: FAILURE_WINDOW_MS };
const REFRESH = { refetchInterval: COUNT_REFRESH_MS };

// The number a count query shows. A failed read clears the number, except
// when the failure is the end of the session: the sign-in dialog explains
// that, the numbers stay as they are, and the read is made again after
// signing in.
function numberOf({
  data,
  error,
  isError,
}: {
  data: number | undefined;
  error: unknown;
  isError: boolean;
}): Count {
  if (isError && !isSessionEnd(error)) {
    return null;
  }
  return typeof data === 'number' ? data : null;
}

// How many tasks run now and how many failed in the last 24 hours, among the
// tasks the signed-in user can see. The numbers come from two reads of one
// row each, so only the total is transferred. They are read when the
// component appears, every minute while the page is in view, and when the
// route enters or leaves the Tasks screen. Each count stands alone: a read
// that fails clears only its own number. While the session has ended and the
// sign-in dialog is open nothing is asked, the numbers stay as they are, and
// one round runs as soon as the user has signed in again. The numbers of one
// account are never shown to another.
export function useTaskCounts(): ITaskCounts {
  const queryClient = useQueryClient();
  const running = useTaskCount(RUNNING, REFRESH);
  const failed = useTaskCount(FAILED, REFRESH);
  const { pathname } = useLocation();
  const tasksPath = formatPath(Paths.core.task.list).replace(/\/$/, '');
  const onTasks =
    pathname === tasksPath || pathname.startsWith(`${tasksPath}/`);
  const wasOnTasks = useRef(onTasks);

  // Entering or leaving the Tasks screen changes what the numbers should say,
  // so they are read again. Marking them out of date reads only those that are
  // in use and switched on, so nothing is asked while the session has ended.
  useEffect(() => {
    if (wasOnTasks.current === onTasks) {
      return;
    }
    wasOnTasks.current = onTasks;
    void queryClient.invalidateQueries({ queryKey: taskKeys.counts });
  }, [onTasks, queryClient]);

  return { running: numberOf(running), failed: numberOf(failed) };
}

const shown = (count: Count): count is number => count !== null && count > 0;

const label = (count: number) =>
  count > PILL_CAP ? `${PILL_CAP}+` : String(count);

const runningName = (count: number) =>
  plural(count, {
    one: '# running task',
    other: '# running tasks',
  });

const failedName = (count: number) =>
  plural(count, {
    one: '# failed task in the last 24 hours',
    other: '# failed tasks in the last 24 hours',
  });

// The accessible name of the Tasks link: its label followed by the full name
// of each pill that shows, so the real numbers are read, not the cap. Absent
// when no pill shows and the label alone names the link.
export function taskEntryName(
  entryLabel: string,
  { running, failed }: ITaskCounts,
): string | undefined {
  const names = [
    shown(running) ? runningName(running) : null,
    shown(failed) ? failedName(failed) : null,
  ].filter(Boolean);

  return names.length > 0 ? [entryLabel, ...names].join(', ') : undefined;
}

// The count pills of the Tasks entry, running first. A pill is absent at zero
// and while its number is unknown. They are for the eye only: the name of the
// link carries the numbers.
export const TaskCountPills = ({ running, failed }: ITaskCounts) => {
  if (!shown(running) && !shown(failed)) {
    return null;
  }

  return (
    <span className='pulp-nav-counts' aria-hidden='true'>
      {shown(running) ? (
        <span className='pulp-count pulp-count--running'>{label(running)}</span>
      ) : null}
      {shown(failed) ? (
        <span className='pulp-count pulp-count--failed'>{label(failed)}</span>
      ) : null}
    </span>
  );
};
