import { t } from '@lingui/core/macro';
import {
  Button,
  CodeBlock,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Title,
} from '@patternfly/react-core';
import CubesIcon from '@patternfly/react-icons/dist/esm/icons/cubes-icon';
import {
  type ComponentProps,
  Fragment,
  useEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  BaseHeader,
  Breadcrumbs,
  ConfirmModal,
  DateComponent,
  EmptyStateCustom,
  InsufficientPermissions,
  ListErrorState,
  LoadingSpinner,
  Main,
  NotFound,
  ProgressReports,
  StatusIndicator,
  closeAlert,
} from 'src/components';
import { useResources } from 'src/entities/core/resource/queries';
import { resourceReference } from 'src/entities/core/resource/reference';
import { taskHref, taskUrlId } from 'src/entities/core/task/href';
import {
  useCancelTask,
  useRelatedTasks,
  useTask,
} from 'src/entities/core/task/queries';
import { Paths, formatPath } from 'src/paths';
import { useSessionEpoch } from 'src/user-context';
import { ObjectPermissions } from 'src/utilities/my-permissions';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { translateTask } from 'src/utilities/translate-task';
import './task.scss';

const CHANGE_TASK = 'core.change_task';
// the states a task can still be stopped in
const STOPPABLE = ['running', 'waiting'];

// The indicator knows the states Pulp names; a state it does not know is shown
// as it is.
type TaskStatus = ComponentProps<typeof StatusIndicator>['status'];

// One resource as the detail shows it.
interface ResourceView {
  name?: string;
  pluginName?: string;
  type: string;
}

// The address holds the id of one task. Another task is another screen: what
// the one left behind showed, its alerts and its open dialog go with it.
const TaskDetail = () => {
  const { task: urlId } = useParams();

  return <TaskDetailScreen key={urlId} urlId={urlId} />;
};

const TaskDetailScreen = ({ urlId }: { urlId: string }) => {
  const { hasPermission, permissionsReady } = useAppContext();
  const sessionEpoch = useSessionEpoch();

  // The id of the address becomes an address of the API only here; an id that
  // is not one has no task and asks for nothing.
  const href = taskHref(urlId);
  const query = useTask(href);
  const task = query.data;

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [cancelModalVisible, setCancelModalVisible] = useState(false);
  const cancelTask = useCancelTask();

  const addAlert = (alert: AlertType) =>
    setAlerts((current) => [
      ...(alert.id ? current.filter(({ id }) => id !== alert.id) : current),
      alert,
    ]);

  // What the server lists for the shown task, read when the change
  // permission is not held on every task.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [objectPermissions] = useState(
    () => new ObjectPermissions(() => rerender()),
  );
  useEffect(() => () => objectPermissions.dispose(), [objectPermissions]);

  // The same user signed in again: roles may have changed with the new
  // session, so what was read for the task is forgotten. The task itself is
  // read again by the query layer, keeping what is on screen until the answer
  // arrives.
  const lastEpoch = useRef(sessionEpoch);
  useEffect(() => {
    if (lastEpoch.current !== sessionEpoch) {
      lastEpoch.current = sessionEpoch;
      objectPermissions.reset();
    }
  }, [sessionEpoch, objectPermissions]);

  // Reads the permissions the server lists for the shown task, once, when a
  // Stop task button could be drawn: the account's global permissions are
  // known and do not already include the change permission.
  useEffect(() => {
    if (
      !task ||
      !permissionsReady ||
      hasPermission(CHANGE_TASK) ||
      !STOPPABLE.includes(task.state) ||
      Array.isArray(task.my_permissions)
    ) {
      return;
    }

    objectPermissions.read(task.pulp_href);
  });

  // The related tasks: only addresses of a task are followed. Each is read
  // once; the poll of this task does not read them again.
  const parentHref =
    task?.parent_task && taskUrlId(task.parent_task) ? task.parent_task : null;
  const childHrefs = (task?.child_tasks ?? []).filter(
    (child) => taskUrlId(child) !== null,
  );
  const related = useRelatedTasks(
    parentHref ? [parentHref, ...childHrefs] : childHrefs,
  );
  const parentResult = parentHref ? related[0] : null;
  const parentTask = parentResult?.data ?? null;
  const childTasks = related
    .slice(parentHref ? 1 : 0)
    .flatMap((result) => (result.data ? [result.data] : []));
  const relatedPending = related.some((result) => result.isLoading);

  // The resources the task reserved. A domain is shown as text and never read;
  // the others are read once each, and one whose read failed is left out.
  const references = (task?.reserved_resources_record ?? []).flatMap(
    (record) => {
      const reference = resourceReference(record);
      return reference ? [reference] : [];
    },
  );
  const resourceResults = useResources(
    references.flatMap((reference) =>
      reference.kind === 'read' ? [reference.href] : [],
    ),
  );
  let nextRead = 0;
  const resources = references.flatMap((reference): ResourceView[] => {
    if (reference.kind === 'text') {
      return [{ type: reference.type, name: reference.name }];
    }
    const result = resourceResults[nextRead++];
    return result?.data
      ? [
          {
            name: result.data.name ?? undefined,
            pluginName: reference.plugin,
            type: reference.type,
          },
        ]
      : [];
  });
  const resourcesPending = resourceResults.some((result) => result.isLoading);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A failed read of a task already on screen keeps it, with one alert that a
  // later failed read replaces while it is open.
  const rereadFailed = query.isError && !!task && !sessionEnded;
  useEffect(() => {
    if (rereadFailed) {
      addAlert({
        id: 'task-read',
        variant: 'danger',
        title: t`Task could not be displayed.`,
        description: requestErrorDescription(query.error),
      });
    }
    // an alert is added once for each failed read
  }, [rereadFailed, query.errorUpdatedAt]);

  const taskName = task ? translateTask(task.name) : '';
  const breadcrumbs = [
    { url: formatPath(Paths.core.task.list), name: t`Task management` },
    { name: task ? taskName : urlId },
  ];
  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  if (href === null || (!task && status === 404)) {
    return <NotFound />;
  }

  // The first read was refused or failed: the header without any action and
  // the reason, never the not-found page.
  if (!task && status === 403) {
    return (
      <>
        {alertList}
        <BaseHeader
          title={t`Task detail`}
          breadcrumbs={<Breadcrumbs links={breadcrumbs} />}
        />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  if (!task && query.isError && !sessionEnded && !query.isFetching) {
    return (
      <>
        {alertList}
        <BaseHeader
          title={t`Task detail`}
          breadcrumbs={<Breadcrumbs links={breadcrumbs} />}
        />
        <Main>
          <ListErrorState
            title={t`Task could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!task) {
    return <LoadingSpinner />;
  }

  const progressReports = task.progress_reports ?? [];
  const name = taskName;

  const stopTask = () => {
    if (cancelTask.isPending) {
      return;
    }
    cancelTask.mutate(task.pulp_href, {
      onSuccess: () => {
        setCancelModalVisible(false);
        addAlert({
          variant: 'success',
          title: taskName,
          description: t`Task "${taskName}" stopped successfully.`,
        });
      },
      onError: (e) => {
        setCancelModalVisible(false);
        // The session ended: the sign-in dialog explains it. The task was not
        // stopped and nothing is repeated.
        if (isSessionEnd(e)) {
          return;
        }
        addAlert({
          variant: 'danger',
          title: t`Task "${taskName}" could not be stopped.`,
          description: requestErrorDescription(e),
        });
      },
    });
  };

  return (
    <>
      {alertList}
      {cancelModalVisible ? (
        <ConfirmModal
          cancelAction={() => setCancelModalVisible(false)}
          confirmAction={stopTask}
          title={t`Stop task`}
          confirmButtonTitle={t`Yes, stop`}
        >
          {t`${name} will stop running.`}
        </ConfirmModal>
      ) : null}
      <BaseHeader
        title={taskName}
        breadcrumbs={<Breadcrumbs links={breadcrumbs} />}
        pageControls={
          STOPPABLE.includes(task.state) &&
          objectPermissions.holds(CHANGE_TASK, task, hasPermission) && (
            <Button
              variant='secondary'
              onClick={() => setCancelModalVisible(true)}
            >
              {t`Stop task`}
            </Button>
          )
        }
        status={
          <StatusIndicator
            className={'pulp-c-task-status'}
            status={task.state as TaskStatus}
          />
        }
      />
      <Main>
        <Flex>
          <Flex direction={{ default: 'column' }} flex={{ default: 'flex_1' }}>
            <FlexItem>
              <section className='pulp-section card-area'>
                <Title headingLevel='h2' size='lg'>
                  {t`Task detail`}
                </Title>
                <br />
                <DescriptionList isHorizontal>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Task name`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {task.name}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  {task.name !== taskName && (
                    <DescriptionListGroup>
                      <DescriptionListTerm>{t`Description`}</DescriptionListTerm>
                      <DescriptionListDescription>
                        {taskName}
                      </DescriptionListDescription>
                    </DescriptionListGroup>
                  )}
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Finished at`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <DateComponent date={task.finished_at} />
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Created on`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      <DateComponent date={task.pulp_created} />
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </section>
            </FlexItem>
            <FlexItem>
              <section className='pulp-section card-area'>
                <Title headingLevel='h2' size='lg'>
                  {t`Task groups`}
                </Title>
                <br />
                <DescriptionList isHorizontal>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Task group`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {task.task_group ? task.task_group : t`No task group`}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Parent task`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {parentTask ? (
                        <Link
                          to={formatPath(Paths.core.task.detail, {
                            task: taskUrlId(parentTask.pulp_href),
                          })}
                        >
                          {translateTask(parentTask.name)}
                        </Link>
                      ) : relatedPending ? null : (
                        t`No parent task`
                      )}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>{t`Child tasks`}</DescriptionListTerm>
                    <DescriptionListDescription>
                      {childTasks.length
                        ? childTasks.map((childTask) => (
                            <Fragment key={childTask.pulp_href}>
                              <Link
                                to={formatPath(Paths.core.task.detail, {
                                  task: taskUrlId(childTask.pulp_href),
                                })}
                              >
                                {translateTask(childTask.name)}
                              </Link>
                              <br />
                            </Fragment>
                          ))
                        : relatedPending
                          ? null
                          : t`No child task`}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                </DescriptionList>
              </section>
            </FlexItem>
            <FlexItem>
              <section className='pulp-section card-area'>
                <Title headingLevel='h2' size='lg'>
                  {t`Reserve resources`}
                </Title>
                <br />
                {resources.length
                  ? resources.map((resource, index) => (
                      <Fragment key={resource.type + index}>
                        {index ? <hr /> : null}
                        <DescriptionList isHorizontal>
                          <DescriptionListGroup>
                            <DescriptionListTerm>{t`Type`}</DescriptionListTerm>
                            <DescriptionListDescription>
                              {resource.type}
                            </DescriptionListDescription>
                          </DescriptionListGroup>
                          {resource.pluginName && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t`Plugin`}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {resource.pluginName}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                          {resource.name && (
                            <DescriptionListGroup>
                              <DescriptionListTerm>{t`Name`}</DescriptionListTerm>
                              <DescriptionListDescription>
                                {resource.name}
                              </DescriptionListDescription>
                            </DescriptionListGroup>
                          )}
                        </DescriptionList>
                      </Fragment>
                    ))
                  : resourcesPending
                    ? null
                    : t`There's no resource record`}
              </section>
            </FlexItem>
          </Flex>
          <Flex direction={{ default: 'column' }} flex={{ default: 'flex_1' }}>
            <FlexItem>
              {!task.error && (
                <section className='pulp-section card-area'>
                  <Title headingLevel='h2' size='lg'>
                    {t`Progress messages`}
                  </Title>
                  <br />
                  {progressReports.length ? (
                    <ProgressReports
                      reports={progressReports}
                      newestFirst
                      divided
                    />
                  ) : (
                    <EmptyStateCustom
                      icon={CubesIcon}
                      title={t`There is no progress message.`}
                      description={t`There is no progress message.`}
                    />
                  )}
                </section>
              )}
              {!!task.error && (
                <section className='pulp-section card-area'>
                  <Title headingLevel='h2' size='lg'>
                    {t`Error message`}
                  </Title>
                  <br />
                  <>
                    <Title headingLevel='h3'>{t`Description`}</Title>
                    <CodeBlock>
                      {String(task.error['description'] ?? '')}
                    </CodeBlock>
                    <Title headingLevel='h3'>{t`Traceback`}</Title>
                    <CodeBlock className={'pulp-code-block'}>
                      {String(task.error['traceback'] ?? '')}
                    </CodeBlock>
                  </>
                </section>
              )}
            </FlexItem>
          </Flex>
        </Flex>
      </Main>
    </>
  );
};

export default TaskDetail;
