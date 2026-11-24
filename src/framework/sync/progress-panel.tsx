import { t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  CardTitle,
  Flex,
  FlexItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
} from '@patternfly/react-core';
import { useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAppContext } from 'src/app-context';
import { Alert, ProgressReports, TaskStateLabel } from 'src/components';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import { taskUrlId } from 'src/entities/core/task/href';
import { type Task, isFinalState } from 'src/entities/core/task/model';
import {
  taskKeys,
  useCancelTask,
  useTask,
} from 'src/entities/core/task/queries';
import { useActiveTaskOf } from 'src/entities/core/task/task-index';
import type { RepositoryBase } from 'src/entities/plugin/model';
import { Paths, formatPath } from 'src/paths';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { translateTask } from 'src/utilities/translate-task';
import { type PluginDescriptor, repositoryOf } from '../descriptor';

// How often the task shown in the panel is read again, until it ends.
export const PANEL_POLL_MS = 2000;

const CHANGE_TASK = 'core.change_task';

// The states a task can still be stopped in.
const STOPPABLE = ['running', 'waiting'];

interface Props {
  repository: RepositoryBase;
  descriptor: PluginDescriptor;
}

// What the panel says besides the progress: a stop that was refused or failed,
// or that came too late.
interface Notice {
  // The task the notice is about; it is not shown for another task.
  task: string;
  variant: 'info' | 'danger';
  title: string;
  description?: ReactNode;
}

// What a task of the repository is to the panel: a sync or a publish is named
// by what it is doing, any other task by its name.
type Kind = 'sync' | 'publish' | 'other';

// The heading of the panel. A sync or a publish is named by what it is doing;
// any other task that holds the repository is named by the task.
function headingOf(task: Task, kind: Kind): string {
  if (kind === 'publish') {
    switch (task.state) {
      case 'waiting':
        return t`Publish queued`;
      case 'running':
        return t`Publish running`;
      case 'completed':
        return t`Publish completed`;
      case 'failed':
        return t`Publish failed`;
      case 'canceled':
      case 'skipped':
        return t`Publish canceled`;
      case 'canceling':
        return t`Publish is being canceled`;
      default:
        return t`Publish`;
    }
  }
  if (kind !== 'sync') {
    return translateTask(task.name);
  }
  switch (task.state) {
    case 'waiting':
      return t`Sync queued`;
    case 'running':
      return t`Sync running`;
    case 'completed':
      return t`Sync completed`;
    case 'failed':
      return t`Sync failed`;
    case 'canceled':
    case 'skipped':
      return t`Sync canceled`;
    case 'canceling':
      return t`Sync is being canceled`;
    default:
      return t`Sync`;
  }
}

// The progress of the waiting or running task of a repository, or of the one
// that has just ended, on the repository's own screen. The task is the one the
// repository holds, wherever it was started: the lookup of it runs while the
// page is open. Once a task is shown it is followed with a read every two
// seconds until it ends, however long that takes, and its final state stays
// until another task takes its place. Nothing is drawn while the repository
// holds none. Leaving the page stops the reads and nothing else: the task goes
// on in the server.
export const SyncProgressPanel = ({ repository, descriptor }: Props) => {
  const queryClient = useQueryClient();
  const titleId = useId();
  const active = useActiveTaskOf(repository.pulp_href);
  const syncTask = repositoryOf(descriptor).sync?.taskName;
  const publishTask = descriptor.publication?.taskName;

  // The task on screen: the active one, kept after it has left the lookup
  // because it ended, until another one is active.
  const activeHref = active.data?.pulp_href ?? null;
  const [followed, setFollowed] = useState<string | null>(null);
  if (activeHref !== null && activeHref !== followed) {
    setFollowed(activeHref);
  }

  const read = useTask(followed, { refetchInterval: PANEL_POLL_MS });
  const task =
    read.data ?? (active.data?.pulp_href === followed ? active.data : null);

  // When the task is seen to have ended, what shows the end of it elsewhere (the
  // last sync, the last task of the list) is read again at once.
  const ended = task !== null && isFinalState(task.state);
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (ended && announced.current !== followed) {
      announced.current = followed;
      void queryClient.invalidateQueries({
        queryKey: taskKeys.activeOf(repository.pulp_href),
      });
    }
  }, [ended, followed, queryClient, repository.pulp_href]);

  // Who may stop the task: the change permission on every task, or on this one
  // by the roles on single objects, which are read only for a user who lacks it
  // everywhere and only while a task that can be stopped is shown.
  const { hasPermission, permissionsReady } = useAppContext();
  const everywhere = hasPermission(CHANGE_TASK);
  const stoppable = task !== null && STOPPABLE.includes(task.state);
  const needsObjectRoles = permissionsReady && !everywhere && stoppable;
  const objectRoles = useObjectPermissions({ enabled: needsObjectRoles });
  const mayStop =
    stoppable &&
    (everywhere ||
      (needsObjectRoles && objectRoles.can(task.pulp_href, CHANGE_TASK)));

  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const cancel = useCancelTask();
  const stopping = useRef(false);

  if (followed === null || !task) {
    return read.isError && !isSessionEnd(read.error) ? (
      <Unreadable read={read} />
    ) : null;
  }

  const isSync = syncTask !== undefined && task.name === syncTask;
  const kind: Kind = isSync
    ? 'sync'
    : publishTask !== undefined && task.name === publishTask
      ? 'publish'
      : 'other';
  const heading = headingOf(task, kind);
  const id = taskUrlId(task.pulp_href);
  const reports = task.progress_reports ?? [];
  const failure = task.error?.['description'];

  const stop = async () => {
    if (stopping.current) {
      return;
    }
    stopping.current = true;
    setNotice(null);
    try {
      await cancel.mutateAsync(task.pulp_href);
    } catch (error) {
      // The session ended: the sign-in dialog explains it, and the task was not
      // stopped.
      if (!isSessionEnd(error)) {
        setNotice(
          requestErrorStatus(error) === 409
            ? {
                task: task.pulp_href,
                variant: 'info',
                title: t`This task has already finished.`,
              }
            : {
                task: task.pulp_href,
                variant: 'danger',
                title: t`Task could not be stopped.`,
                description: requestErrorDescription(error),
              },
        );
      }
    } finally {
      stopping.current = false;
      setConfirming(false);
    }
  };

  return (
    <>
      <Card
        component='section'
        aria-labelledby={titleId}
        data-cy='SyncProgress'
        isCompact
        style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
      >
        <CardHeader>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
          >
            <FlexItem>
              <CardTitle id={titleId}>{heading}</CardTitle>
            </FlexItem>
            <FlexItem>
              <TaskStateLabel state={task.state} />
            </FlexItem>
          </Flex>
        </CardHeader>
        <CardBody>
          {read.isError && !isSessionEnd(read.error) ? (
            <Unreadable read={read} />
          ) : null}
          {notice && notice.task === task.pulp_href ? (
            <Alert
              isInline
              variant={notice.variant}
              title={notice.title}
              style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
            >
              {notice.description}
            </Alert>
          ) : null}
          {reports.length > 0 ? (
            <ProgressReports reports={reports} newestFirst />
          ) : (
            <p>
              {task.state === 'waiting'
                ? t`Waiting for a worker to take the task.`
                : t`No progress reported yet.`}
            </p>
          )}
          {task.state === 'failed' && typeof failure === 'string' && failure ? (
            <p>{failure}</p>
          ) : null}
        </CardBody>
        <CardFooter>
          <Flex spaceItems={{ default: 'spaceItemsMd' }}>
            {mayStop ? (
              <FlexItem>
                <Button
                  variant='secondary'
                  isDanger
                  isDisabled={cancel.isPending}
                  onClick={() => setConfirming(true)}
                >
                  {isSync ? t`Cancel sync` : t`Cancel task`}
                </Button>
              </FlexItem>
            ) : null}
            {id ? (
              <FlexItem>
                <Link
                  to={formatPath(Paths.core.task.detail, {
                    task: taskUrlId(task.pulp_href),
                  })}
                >
                  {t`View the task`}
                </Link>
              </FlexItem>
            ) : null}
          </Flex>
        </CardFooter>
      </Card>
      {confirming ? (
        <StopDialog
          title={isSync ? t`Cancel sync` : t`Cancel task`}
          name={heading}
          isPending={cancel.isPending}
          onConfirm={stop}
          onDismiss={() => setConfirming(false)}
        />
      ) : null}
    </>
  );
};

// Why the task cannot be followed: a task the user may not read or that is no
// longer there ends the reads, as does a first read that failed, which can be
// asked for again.
const Unreadable = ({ read }: { read: ReturnType<typeof useTask> }) => {
  const status = requestErrorStatus(read.error);
  const title =
    status === 404
      ? t`This task no longer exists.`
      : t`The progress of this task cannot be shown.`;

  return (
    <Alert
      isInline
      variant='warning'
      title={title}
      actionLinks={
        status === 403 || status === 404 ? undefined : (
          <AlertActionLink onClick={() => read.refetch()}>
            {t`Retry`}
          </AlertActionLink>
        )
      }
      style={{ marginBottom: 'var(--pf-t--global--spacer--md)' }}
    >
      {requestErrorDescription(read.error)}
    </Alert>
  );
};

// The confirmation before a task is asked to stop. Its own buttons say what
// they do, so that "Cancel" never means two things on one screen.
const StopDialog = ({
  title,
  name,
  isPending,
  onConfirm,
  onDismiss,
}: {
  title: string;
  name: string;
  isPending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) => {
  const labelId = useId();

  return (
    <Modal
      aria-labelledby={labelId}
      isOpen
      onClose={() => {
        if (!isPending) {
          onDismiss();
        }
      }}
      variant='small'
    >
      <ModalHeader labelId={labelId} title={title} titleIconVariant='warning' />
      <ModalBody>{t`${name} will stop running.`}</ModalBody>
      <ModalFooter>
        <Button variant='primary' isDisabled={isPending} onClick={onConfirm}>
          {t`Yes, cancel`}
        </Button>
        <Button variant='link' isDisabled={isPending} onClick={onDismiss}>
          {t`Keep running`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};
