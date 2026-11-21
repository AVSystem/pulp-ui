import { t } from '@lingui/core/macro';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useAppContext } from 'src/app-context';
import type { AlertType } from 'src/components';
import { useDeleteEntity } from 'src/entities/plugin/queries';
import type { Options } from 'src/entities/plugin/request';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { taskAlert } from 'src/utilities/task-alert';
import { useWatchTask } from '../watched-tasks';

// The one way a remote of any plugin is deleted, from its detail or from a row
// of a list. The delete is sent once; the server answers with the task that
// does the work, which the application root follows to its end wherever the
// user is by then, so the screen neither waits for the task nor loses its
// result.

// What a delete of a remote came to, as far as the screen that asked for it
// can tell.
export type DeleteRemoteResult =
  // the server accepted the delete and started the task
  | { status: 'accepted'; task: string }
  // the delete was refused or failed. `uncertain` is false when the server
  // answered that it did not do it, and true when nothing is known: the
  // request got no answer, or something went wrong after it was accepted, so
  // the remote may already be gone.
  | { status: 'failed'; failure: ReactNode; uncertain: boolean }
  // the session ended: the sign-in dialog explains it and the delete can be
  // asked for again
  | { status: 'session-ended' }
  // another delete from this screen is still on its way; nothing was sent
  | { status: 'busy' };

interface Entity {
  readonly app: string;
  readonly object: string;
  remove: (href: string, options?: Options) => Promise<string>;
}

interface RemoveOptions {
  // Called once the server has accepted the delete, with the alert that says
  // so, and only while the screen that asked is still shown. A user who left
  // meanwhile is not moved: the alert is queued for the screen they are on.
  onAccepted?: (alert: AlertType) => void;
}

// Deletes remotes of one plugin. `remove` sends the request, hands the task to
// the watcher and calls back; the single-send guard it holds is released when
// the request has settled, whatever it came to, so a failure never leaves the
// button dead.
export function useDeleteRemote(entity: Entity) {
  const request = useDeleteEntity(entity);
  const { watch } = useWatchTask();
  const { queueAlert } = useAppContext();
  const [isPending, setPending] = useState(false);
  // Set synchronously, so a second press before the screen has drawn the first
  // still sends nothing.
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { mutateAsync } = request;
  const { app, object } = entity;

  const remove = useCallback(
    async (
      { name, pulp_href }: { name: string; pulp_href: string },
      { onAccepted }: RemoveOptions = {},
    ): Promise<DeleteRemoteResult> => {
      if (running.current) {
        return { status: 'busy' };
      }
      running.current = true;
      setPending(true);

      try {
        let task: string;
        try {
          task = await mutateAsync({ href: pulp_href });
        } catch (error) {
          if (isSessionEnd(error)) {
            return { status: 'session-ended' };
          }
          return {
            status: 'failed',
            failure: requestErrorDescription(error),
            uncertain: requestErrorStatus(error) === null,
          };
        }

        // The request is accepted: from here a failure does not mean the remote
        // is still there.
        try {
          watch({
            href: task,
            label: t`Removal of remote ${name}`,
            resource: { app, object, href: pulp_href },
          });
          const alert = taskAlert(
            task,
            t`Removal started for remote ${name}`,
          ) as AlertType;
          if (mounted.current) {
            onAccepted?.(alert);
          } else {
            queueAlert(alert);
          }
        } catch (error) {
          return {
            status: 'failed',
            failure: requestErrorDescription(error),
            uncertain: true,
          };
        }
        return { status: 'accepted', task };
      } finally {
        running.current = false;
        if (mounted.current) {
          setPending(false);
        }
      }
    },
    [mutateAsync, watch, queueAlert, app, object],
  );

  return { remove, isPending };
}
