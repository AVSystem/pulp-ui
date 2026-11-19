import { plural, t } from '@lingui/core/macro';
import {
  Button,
  NotificationBadge,
  NotificationDrawer,
  NotificationDrawerBody,
  NotificationDrawerHeader,
  NotificationDrawerList,
  NotificationDrawerListItem,
  NotificationDrawerListItemBody,
  NotificationDrawerListItemHeader,
} from '@patternfly/react-core';
import BellIcon from '@patternfly/react-icons/dist/esm/icons/bell-icon';
import ExclamationCircleIcon from '@patternfly/react-icons/dist/esm/icons/exclamation-circle-icon';
import { useQueryClient } from '@tanstack/react-query';
import { DateTime } from 'luxon';
import {
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Link } from 'react-router';
import { EmptyStateCustom } from 'src/components/empty-state-custom';
import type { Task, TaskListParams } from 'src/entities/core/task/model';
import { taskKeys, useTasks } from 'src/entities/core/task/queries';
import { language } from 'src/l10n';
import { Paths, formatPath } from 'src/paths';
import { parsePulpIDFromURL } from 'src/utilities/parse-pulp-id';
import { isSessionEnd, requestErrorStatus } from 'src/utilities/request-error';

// Where the browser remembers when the panel was last opened.
export const NOTIFICATIONS_SEEN_KEY = 'pulp-notifications-seen';

// How often the list is asked for again while the page is in view.
export const NOTIFICATIONS_REFRESH_MS = 60_000;

// How far back an ended task still appears in the panel.
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// How many tasks the panel lists.
const LIST_SIZE = 20;

// The most the bell shows as a number; more reads as "99+".
const BADGE_CAP = 99;

const BELL_ID = 'pulp-notifications-bell';
const HEADER_ID = 'pulp-notifications-header';

// A task that has a finish time: the read asks for tasks that finished, so a
// row without one is not listed.
type IEndedTask = Task & { finished_at: string };

// What the panel lists: the tasks that ended recently, newest first.
const LIST_PARAMS: TaskListParams = {
  state__in: 'failed,completed,canceled',
  finishedWithinMs: WINDOW_MS,
  sort: '-finished_at',
  page_size: LIST_SIZE,
};

const hasEnded = (task: Task): task is IEndedTask =>
  typeof task.finished_at === 'string';

type Status = 'loading' | 'ready' | 'error' | 'forbidden';

// The time the panel was last opened in this browser, in milliseconds, or null
// when nothing usable is stored: the value is only trusted when it parses as an
// ISO time.
function readSeen(): number | null {
  try {
    const stored = window.localStorage.getItem(NOTIFICATIONS_SEEN_KEY);
    const time = stored ? DateTime.fromISO(stored) : null;
    return time?.isValid ? time.toMillis() : null;
  } catch {
    return null;
  }
}

function writeSeen(millis: number) {
  try {
    window.localStorage.setItem(
      NOTIFICATIONS_SEEN_KEY,
      new Date(millis).toISOString(),
    );
  } catch {
    // The marker then lasts for this page only.
  }
}

// The marker to start from: the stored one, or, on a first visit, now, which
// is stored too so that nothing that ended before counts as unread.
function startingSeen(): number {
  const stored = readSeen();
  if (stored !== null) {
    return stored;
  }
  const now = Date.now();
  writeSeen(now);
  return now;
}

interface INotifications {
  // Whether the bell exists at all: for a signed-in user who may list tasks.
  available: boolean;
  status: Status;
  tasks: IEndedTask[];
  // How many listed tasks ended after the panel was last opened.
  unread: number;
  isOpen: boolean;
  // Whether the task is shown as unread: it ended after the previous time the
  // panel was opened, which stays the reference until the panel closes.
  isUnread: (task: IEndedTask) => boolean;
  toggle: () => void;
  // Closes the panel; the focus goes back to the bell when asked.
  close: (restoreFocus?: boolean) => void;
  retry: () => void;
}

const NotificationsContext = createContext<INotifications | null>(null);

function useNotifications(): INotifications {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error('Notifications are used outside their provider');
  }
  return value;
}

const endedMillis = (task: IEndedTask) =>
  DateTime.fromISO(task.finished_at).toMillis();

// The tasks that ended recently among those the signed-in user can see, the
// panel's open state and the read marker kept in this browser. Nothing is
// stored on the server. The list is read when the provider is enabled, every
// minute while the page is in view, and when the panel opens. While the
// session has ended and the sign-in dialog is open nothing is asked: the list
// and the bell stay as they are, and the list is read once as soon as the user
// has signed in again. The list of one account is never shown to another.
export const NotificationsProvider = ({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) => {
  const queryClient = useQueryClient();
  const [seen, setSeen] = useState<number | null>(null);
  const [isOpen, setOpen] = useState(false);
  // The marker as it was when the panel opened.
  const [openedAgainst, setOpenedAgainst] = useState<number | null>(null);
  const list = useTasks(LIST_PARAMS, {
    enabled,
    refetchInterval: NOTIFICATIONS_REFRESH_MS,
  });

  // A refusal takes the bell away for good; a failure of the first read is
  // shown with a retry; a later failure keeps the list the panel already has.
  // The end of the session is not a failure of the list: the sign-in dialog
  // explains it and the list is read again afterwards.
  let status: Status = 'loading';
  if (enabled) {
    if (requestErrorStatus(list.error) === 403) {
      status = 'forbidden';
    } else if (list.data) {
      status = 'ready';
    } else if (list.isError && !isSessionEnd(list.error)) {
      status = 'error';
    }
  }

  const tasks = useMemo(
    () => (enabled && list.data ? list.data.results.filter(hasEnded) : []),
    [enabled, list.data],
  );

  // Reads the list again now, unless nobody is signed in or the session has
  // ended: marking the read out of date reads only what is in use.
  const refresh = useCallback(
    () =>
      void queryClient.invalidateQueries({
        queryKey: taskKeys.list(LIST_PARAMS),
        exact: true,
      }),
    [queryClient],
  );

  useEffect(() => {
    if (!enabled) {
      // Nothing of the previous session may outlive it: the next user starts
      // with a closed panel and no list.
      setOpen(false);
      setOpenedAgainst(null);
      setSeen(null);
      queryClient.removeQueries({
        queryKey: taskKeys.list(LIST_PARAMS),
        exact: true,
      });
      return;
    }

    setSeen(startingSeen());
  }, [enabled, queryClient]);

  const open = useCallback(() => {
    const now = Date.now();
    setOpenedAgainst(seen);
    setSeen(now);
    writeSeen(now);
    setOpen(true);
    refresh();
  }, [seen, refresh]);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      document.getElementById(BELL_ID)?.focus();
    }
  }, []);

  const retry = refresh;

  const reference = isOpen ? openedAgainst : seen;
  const isUnread = useCallback(
    (task: IEndedTask) => reference !== null && endedMillis(task) > reference,
    [reference],
  );

  const unread = useMemo(
    () =>
      seen === null
        ? 0
        : tasks.filter((task) => endedMillis(task) > seen).length,
    [tasks, seen],
  );

  const value = useMemo<INotifications>(
    () => ({
      available: enabled && status !== 'forbidden',
      status,
      tasks,
      unread,
      isOpen,
      isUnread,
      toggle: () => (isOpen ? close() : open()),
      close,
      retry,
    }),
    [enabled, status, tasks, unread, isOpen, isUnread, open, close, retry],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
};

// Whether the panel is expanded, for the page that hosts it. A panel that is
// not available renders nothing, so it is never reported as expanded: the page
// would otherwise keep an empty column open.
export const useNotificationsOpen = () => {
  const { isOpen, available } = useNotifications();
  return isOpen && available;
};

const bellName = (unread: number) =>
  unread > 0
    ? plural(unread, {
        one: 'Notifications, # unread notification',
        other: 'Notifications, # unread notifications',
      })
    : t`Notifications`;

// The number the bell shows, capped; nothing at zero.
const badgeText = (unread: number) => {
  if (unread === 0) {
    return undefined;
  }
  return unread > BADGE_CAP ? `${BADGE_CAP}+` : String(unread);
};

// The bell of the top bar. It shows how many listed tasks are unread, orange
// while there are any and without a number otherwise, and opens the panel.
export const NotificationBell = () => {
  const { available, unread, isOpen, toggle } = useNotifications();

  if (!available) {
    return null;
  }

  return (
    <NotificationBadge
      id={BELL_ID}
      className='pulp-topbar__bell'
      aria-label={bellName(unread)}
      variant={unread > 0 ? 'attention' : 'read'}
      isExpanded={isOpen}
      icon={<BellIcon />}
      attentionIcon={<BellIcon />}
      onClick={toggle}
    >
      {badgeText(unread)}
    </NotificationBadge>
  );
};

const VARIANTS: Record<string, 'danger' | 'success' | 'info'> = {
  failed: 'danger',
  completed: 'success',
  canceled: 'info',
};

// "3 minutes ago" within the first day after the end, "yesterday" or "3 days
// ago" from then on, counted in days so a task from the end of last month is
// not described as "last month". In the language of the page.
function relativeTime(finishedAt: string): string {
  const time = DateTime.fromISO(finishedAt, { locale: language });
  if (!time.isValid) {
    return '';
  }
  const days = DateTime.now().diff(time).as('days');
  return (
    (days < 1
      ? time.toRelative()
      : time.toRelativeCalendar({ unit: 'days' })) ?? ''
  );
}

function outcomeText(state: string, when: string): string {
  switch (state) {
    case 'failed':
      return t`Failed ${when}`.trim();
    case 'completed':
      return t`Completed ${when}`.trim();
    case 'canceled':
      return t`Canceled ${when}`.trim();
    default:
      return when;
  }
}

// One ended task. The name is React text inside the link, never markup.
const NotificationItem = ({
  task,
  unread,
  onNavigate,
}: {
  task: IEndedTask;
  unread: boolean;
  onNavigate: () => void;
}) => {
  const taskId = parsePulpIDFromURL(task.pulp_href);
  // The header's title is typed as text but is rendered as a node, so the name
  // can be the link to the task.
  const title = (
    <Link
      to={formatPath(Paths.core.task.detail, { task: taskId })}
      title={task.name}
      onClick={onNavigate}
    >
      {task.name}
    </Link>
  ) as unknown as string;

  return (
    <NotificationDrawerListItem
      variant={VARIANTS[task.state] ?? 'info'}
      isRead={!unread}
      isHoverable={false}
    >
      <NotificationDrawerListItemHeader
        variant={VARIANTS[task.state] ?? 'info'}
        title={title}
        truncateTitle={2}
      />
      <NotificationDrawerListItemBody>
        <time dateTime={task.finished_at}>
          {outcomeText(task.state, relativeTime(task.finished_at))}
        </time>
      </NotificationDrawerListItemBody>
    </NotificationDrawerListItem>
  );
};

// The panel the page hosts beside its content: the tasks that ended in the
// last seven days, with the ones that ended since the previous visit marked.
// It renders nothing for a user without a bell.
export const NotificationPanel = () => {
  const { available, status, tasks, isOpen, isUnread, close, retry } =
    useNotifications();

  // The page mounts the content of the panel once it is expanded.
  useEffect(() => {
    if (isOpen && available) {
      document.getElementById(HEADER_ID)?.focus({ preventScroll: true });
    }
  }, [isOpen, available]);

  if (!available) {
    return null;
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      close(true);
    }
  };

  let body: ReactNode = null;
  if (status === 'error') {
    body = (
      <EmptyStateCustom
        variant='xs'
        icon={ExclamationCircleIcon}
        title={t`Notifications could not be loaded.`}
        description=''
        button={
          <Button variant='primary' onClick={retry}>
            {t`Retry loading notifications`}
          </Button>
        }
      />
    );
  } else if (status === 'ready' && tasks.length === 0) {
    body = (
      <EmptyStateCustom
        variant='xs'
        title={t`No finished tasks yet`}
        description={t`Your tasks appear here when they fail, complete or are canceled.`}
      />
    );
  } else if (status === 'ready') {
    body = (
      <NotificationDrawerList>
        {tasks.map((task) => (
          <NotificationItem
            key={task.pulp_href}
            task={task}
            unread={isUnread(task)}
            onNavigate={() => close()}
          />
        ))}
      </NotificationDrawerList>
    );
  }

  return (
    <NotificationDrawer className='pulp-notifications' onKeyDown={onKeyDown}>
      <NotificationDrawerHeader
        id={HEADER_ID}
        tabIndex={-1}
        title={t`Notifications`}
        closeButtonAriaLabel={t`Close notifications`}
        onClose={() => close(true)}
      />
      <div className='pulp-notifications__all'>
        <Link to={formatPath(Paths.core.task.list)} onClick={() => close()}>
          {t`View all tasks`}
        </Link>
      </div>
      <NotificationDrawerBody>{body}</NotificationDrawerBody>
    </NotificationDrawer>
  );
};
