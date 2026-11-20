import { t } from '@lingui/core/macro';
import { type Query, useQueries, useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router';
import { z } from 'zod';
import type { AlertType } from 'src/components/alert-list';
import { TaskClient } from 'src/entities/core/task/client';
import { taskUrlId } from 'src/entities/core/task/href';
import { type Task, isFinalState } from 'src/entities/core/task/model';
import { taskKeys } from 'src/entities/core/task/queries';
import { pulpHrefSchema } from 'src/entities/href';
import { entityKeys } from 'src/entities/plugin/queries';
import { Paths, formatPath } from 'src/paths';
import { useSessionEnded } from 'src/session/session-events';
import { sessionKey, useUserContext } from 'src/user-context';
import { isSessionEnd, requestErrorStatus } from 'src/utilities/request-error';
import {
  readStored,
  removeStored,
  writeStored,
} from 'src/utilities/safe-storage';

// How often a task started in this tab is read until it ends. Reading pauses
// in a hidden tab and while the session has ended, and there is no attempt
// limit: a sync may run for hours.
export const WATCH_POLL_MS = 5_000;

// Where the list of watched tasks is kept for the tab, so a reload does not
// lose them. A task address is not a credential, and the list is tied to the
// account it was made for.
export const WATCHED_TASKS_STORAGE_KEY = 'pulp-ui:watched-tasks';

// A task started in this tab that the application follows to its end, wherever
// the user is by then. The label names what the task does for the user ("Sync
// of tools"). The resource is what the task works on: when the task ends, the
// reads of that plugin's repositories and of the tasks are made again.
export interface WatchedTask {
  href: string;
  label: string;
  resource?: { app: string; object: string; href: string };
}

// What a screen needs of the watcher. The default does nothing, so a screen
// rendered without the provider (a test, a story) neither watches nor fails.
interface WatchedTasksControl {
  watch: (task: WatchedTask) => void;
  forget: () => void;
  alerts: AlertType[];
  dismiss: (index: number) => void;
}

const NO_TASKS: WatchedTask[] = [];
const NO_ALERTS: AlertType[] = [];
const NOTHING: WatchedTasksControl = {
  watch: () => undefined,
  forget: () => undefined,
  alerts: NO_ALERTS,
  dismiss: () => undefined,
};

const WatchedTasksContext = createContext<WatchedTasksControl>(NOTHING);

// Starts following a task. Anything that is not the address of a task is
// ignored, because the address later decides where a request goes.
export const useWatchTask = () => {
  const { watch } = useContext(WatchedTasksContext);
  return { watch };
};

// What the watcher has to say about the tasks that ended, as alerts for the
// shell to show, and the way to close one by its index.
export const useWatchedAnnouncements = () => {
  const { alerts, dismiss } = useContext(WatchedTasksContext);
  return { alerts, dismiss };
};

// Drops every watched task, in memory and in storage, and every announcement
// not yet closed. Used when the account in memory goes away or changes.
export const useForgetWatchedTasks = () =>
  useContext(WatchedTasksContext).forget;

// Letters, digits and underscores only: the names of a plugin and its object
// become part of a cache key.
const NAME = /^\w+$/;

const watchedTaskSchema = z.object({
  href: pulpHrefSchema.refine((href) => taskUrlId(href) !== null),
  label: z.string().max(300),
  resource: z
    .object({
      app: z.string().regex(NAME),
      object: z.string().regex(NAME),
      href: pulpHrefSchema,
    })
    .optional(),
});

const storedSchema = z.object({
  owner: z.string(),
  tasks: z.array(z.unknown()),
});

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// The tasks stored for this account that can still be trusted. A value that is
// broken, of another shape or made for another account is removed; of a list
// made for this account only the entries that are the address of a task and
// carry a text label are kept.
function storedTasksOf(owner: string): WatchedTask[] {
  const text = readStored(WATCHED_TASKS_STORAGE_KEY, 'sessionStorage');
  if (text === null) {
    return NO_TASKS;
  }
  const stored = storedSchema.safeParse(parseJson(text));
  if (!stored.success || stored.data.owner !== owner) {
    removeStored(WATCHED_TASKS_STORAGE_KEY, 'sessionStorage');
    return NO_TASKS;
  }
  const kept: WatchedTask[] = [];
  for (const item of stored.data.tasks) {
    const task = watchedTaskSchema.safeParse(item);
    if (task.success && !kept.some(({ href }) => href === task.data.href)) {
      kept.push(task.data);
    }
  }
  if (kept.length === 0) {
    removeStored(WATCHED_TASKS_STORAGE_KEY, 'sessionStorage');
  }
  return kept;
}

function storeTasks(owner: string | null, tasks: WatchedTask[]) {
  if (owner === null) {
    return;
  }
  if (tasks.length === 0) {
    removeStored(WATCHED_TASKS_STORAGE_KEY, 'sessionStorage');
    return;
  }
  writeStored(
    WATCHED_TASKS_STORAGE_KEY,
    JSON.stringify({ owner, tasks }),
    'sessionStorage',
  );
}

// Whether a task can be followed no longer although it has not ended: the
// server refused it or does not know it, or its first read failed. A later
// read that fails for another reason on a task that was shown is tried again,
// and so is a read that the end of the session held back.
function isLost(data: Task | undefined, error: unknown): boolean {
  if (!error) {
    return false;
  }
  const status = requestErrorStatus(error);
  return status === 403 || status === 404 || (!data && !isSessionEnd(error));
}

// Whether a watched task is to be read no more: it ended or it is lost.
function stopsWatching(query: Query<Task>): boolean {
  const { data, error } = query.state;
  return Boolean(data && isFinalState(data.state)) || isLost(data, error);
}

// The link to the task of an alert, or nothing for an address that is not one.
function taskLink(href: string) {
  return taskUrlId(href) ? (
    <Link to={formatPath(Paths.core.task.detail, { task: taskUrlId(href) })}>
      {t`View the task`}
    </Link>
  ) : undefined;
}

// The alert for a task that has ended, with the link to the task.
function endAlert(task: WatchedTask, state: string): AlertType {
  const { label } = task;
  const shown: Pick<AlertType, 'variant' | 'title'> =
    state === 'completed'
      ? { variant: 'success', title: t`${label} finished.` }
      : state === 'failed'
        ? { variant: 'danger', title: t`${label} failed.` }
        : state === 'canceled'
          ? { variant: 'warning', title: t`${label} was canceled.` }
          : { variant: 'info', title: t`${label} was skipped.` };

  return { ...shown, description: taskLink(task.href), live: true };
}

// The alert for a task that cannot be followed any more.
function lostAlert(task: WatchedTask): AlertType {
  const { label } = task;

  return {
    variant: 'info',
    title: t`${label} can no longer be followed.`,
    description: taskLink(task.href),
    live: true,
  };
}

interface Held<Item> {
  generation: number;
  items: Item[];
}

// Follows the tasks started in this browser tab at the application root, so
// leaving the screen that started one neither stops nor loses it. Each task is
// read every few seconds until it ends; the end is announced once, with a link
// to the task, and the data it changed is read again. The list belongs to the
// account that made it: another account, or none, never sees it, polls it or
// is told about it.
export function WatchedTasksProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { user, generation } = useUserContext();
  const { ended } = useSessionEnded();
  const owner = sessionKey(user);

  // The generation grows whenever the account in memory goes away or changes.
  // What was kept under an older generation counts as empty from the first
  // render of the new one, before any effect has had the chance to clear it.
  const [held, setHeld] = useState<Held<WatchedTask>>({
    generation,
    items: NO_TASKS,
  });
  const [announced, setAnnounced] = useState<Held<AlertType>>({
    generation,
    items: NO_ALERTS,
  });
  const tasks = held.generation === generation ? held.items : NO_TASKS;
  const alerts =
    announced.generation === generation ? announced.items : NO_ALERTS;

  // The current values for the functions below, which stay the same functions
  // for the life of the provider.
  const now = useRef({ owner, generation, held });
  useEffect(() => {
    now.current.owner = owner;
    now.current.generation = generation;
  }, [owner, generation]);
  // The tasks whose end was announced or that were dropped, so a second pass of
  // the effect below never announces one twice.
  const settled = useRef(new Set<string>());

  const change = useCallback(
    (update: (current: WatchedTask[]) => WatchedTask[]) => {
      const { generation: at } = now.current;
      const current = now.current.held;
      const base = current.generation === at ? current.items : NO_TASKS;
      const next = update(base);
      if (next === base) {
        return;
      }
      now.current.held = { generation: at, items: next };
      setHeld(now.current.held);
      storeTasks(now.current.owner, next);
    },
    [],
  );

  const announce = useCallback((alert: AlertType) => {
    const { generation: at } = now.current;
    setAnnounced((current) => ({
      generation: at,
      items: [
        ...(current.generation === at ? current.items : NO_ALERTS),
        alert,
      ],
    }));
  }, []);

  const watch = useCallback(
    (task: WatchedTask) => {
      if (taskUrlId(task.href) === null) {
        return;
      }
      settled.current.delete(task.href);
      change((current) =>
        current.some(({ href }) => href === task.href)
          ? current
          : [...current, task],
      );
    },
    [change],
  );

  const forget = useCallback(() => {
    const { generation: at } = now.current;
    now.current.held = { generation: at, items: NO_TASKS };
    setHeld(now.current.held);
    setAnnounced({ generation: at, items: NO_ALERTS });
    removeStored(WATCHED_TASKS_STORAGE_KEY, 'sessionStorage');
  }, []);

  const dismiss = useCallback((index: number) => {
    setAnnounced((current) => ({
      ...current,
      items: current.items.filter((_alert, at) => at !== index),
    }));
  }, []);

  // A reload of the tab: the list kept for the same account comes back as soon
  // as the account is known. Once per account, so a list made afterwards is
  // never replaced by the stored one.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (owner === null) {
      restoredFor.current = null;
      return;
    }
    if (restoredFor.current === owner) {
      return;
    }
    restoredFor.current = owner;
    const restored = storedTasksOf(owner);
    if (restored.length > 0) {
      change((current) => [
        ...restored.filter(
          ({ href }) => !current.some((task) => task.href === href),
        ),
        ...current,
      ]);
    }
  }, [owner, generation, change]);

  const reads = useQueries({
    queries: tasks.map((task) => ({
      queryKey: taskKeys.detail(task.href),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        TaskClient.retrieve(task.href, { signal }),
      enabled: !ended,
      refetchInterval: (query: Query<Task>) =>
        stopsWatching(query) ? false : WATCH_POLL_MS,
    })),
  });

  useEffect(() => {
    tasks.forEach((task, index) => {
      const read = reads[index];
      if (!read || settled.current.has(task.href)) {
        return;
      }
      const state = read.data?.state;
      const finished = state !== undefined && isFinalState(state);
      if (!finished && !(read.isError && isLost(read.data, read.error))) {
        return;
      }

      settled.current.add(task.href);
      announce(finished ? endAlert(task, state) : lostAlert(task));
      if (finished) {
        // What the task changed is read again: the repository and its
        // versions, and the tasks every list and panel shows.
        void queryClient.invalidateQueries({ queryKey: taskKeys.index });
        if (task.resource) {
          const { app, object, href } = task.resource;
          void queryClient.invalidateQueries({
            queryKey: entityKeys({ app, object }).all,
          });
          void queryClient.invalidateQueries({
            queryKey: taskKeys.activeOf(href),
          });
          void queryClient.invalidateQueries({
            queryKey: taskKeys.lastOf(href),
          });
        }
      }
      change((current) => current.filter(({ href }) => href !== task.href));
    });
  });

  const control = useMemo(
    () => ({ watch, forget, alerts, dismiss }),
    [watch, forget, alerts, dismiss],
  );

  return (
    <WatchedTasksContext.Provider value={control}>
      {children}
    </WatchedTasksContext.Provider>
  );
}
