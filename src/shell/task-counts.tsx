import { plural } from '@lingui/core/macro';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { TaskAPI } from 'src/api/task';
import { Paths, formatPath } from 'src/paths';
import { isSuspended, subscribe } from 'src/session/session-events';

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

// How many tasks run now and how many failed in the last 24 hours, among the
// tasks the signed-in user can see. The numbers come from two list requests of
// one row each, so only the total is transferred. They are asked for when the
// component appears, every minute while the page is in view, and when the
// route enters or leaves the Tasks screen. Each count stands alone: a request
// that fails clears only its own number. While the session has ended and the
// sign-in dialog is open nothing is asked, the numbers stay as they are, and
// one round runs as soon as the user has signed in again.
export function useTaskCounts(): ITaskCounts {
  const [counts, setCounts] = useState<ITaskCounts>({
    running: null,
    failed: null,
  });
  // Identifies the latest round of requests, so an answer to an earlier one,
  // or one that arrives after the component is gone, is ignored.
  const latest = useRef(0);
  const { pathname } = useLocation();
  const tasksPath = formatPath(Paths.core.task.list).replace(/\/$/, '');
  const onTasks =
    pathname === tasksPath || pathname.startsWith(`${tasksPath}/`);

  useEffect(() => {
    const load = () => {
      if (isSuspended()) {
        return;
      }

      const current = ++latest.current;
      const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();

      const ask = (key: keyof ITaskCounts, params: Record<string, unknown>) =>
        TaskAPI.list({ ...params, page_size: 1 })
          .then(
            ({ data }) => (typeof data?.count === 'number' ? data.count : null),
            () => null,
          )
          .then((count) => {
            if (current === latest.current) {
              setCounts((previous) => ({ ...previous, [key]: count }));
            }
          });

      ask('running', { state: 'running' });
      ask('failed', { state: 'failed', finished_at__gte: since });
    };

    load();
    // Notified on every change of the session; only the one that lifts the
    // pause starts a round.
    const unsubscribe = subscribe(load);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        load();
      }
    }, COUNT_REFRESH_MS);

    return () => {
      clearInterval(timer);
      unsubscribe();
      latest.current++;
    };
  }, [onTasks]);

  return counts;
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
