import { t } from '@lingui/core/macro';
import {
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import {
  type ComponentProps,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { OrphanCleanupAPI, RepairAPI, TaskPurgeAPI } from 'src/api';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  CompoundFilter,
  ConfirmModal,
  DateComponent,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  LoadingSpinner,
  Main,
  OrphanCleanupTaskModal,
  PulpPagination,
  PurgeTaskModal,
  RepairTaskModal,
  SortTable,
  StatusIndicator,
  Table,
  closeAlert,
} from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { DEFAULT_PAGE_SIZE, type Task } from 'src/entities/core/task/model';
import { useCancelTask, useTasks } from 'src/entities/core/task/queries';
import { Paths, formatPath } from 'src/paths';
import { useSessionEpoch } from 'src/user-context';
import { filterIsSet } from 'src/utilities/filter-is-set';
import { ObjectPermissions } from 'src/utilities/my-permissions';
import { ParamHelper } from 'src/utilities/param-helper';
import { parsePulpIDFromURL } from 'src/utilities/parse-pulp-id';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { translateTask } from 'src/utilities/translate-task';
import './task.scss';

const ORPHAN_PROTECTION_TIME = 1440;
const CHANGE_TASK = 'core.change_task';
// the states a task can still be stopped in
const STOPPABLE = ['running', 'waiting'];

// The indicator knows the states Pulp names; a state it does not know is shown
// as it is.
type TaskStatus = ComponentProps<typeof StatusIndicator>['status'];

const DEFAULT_SORT = '-pulp_created';

// The address holds the page, its size, the order and the filters; the screen
// shows exactly what the address says, and a change goes through the address.
function paramsOfAddress(search: string) {
  const params = ParamHelper.parseParamString(search, ['page', 'page_size']);

  if (!params['page_size']) {
    params['page_size'] = DEFAULT_PAGE_SIZE;
  }
  if (!params['sort']) {
    params['sort'] = DEFAULT_SORT;
  }

  return params;
}

// A parameter that came in more than once is read as its first value.
function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === null ? undefined : String(first);
}

export const TaskListView = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, isStaff, permissionsReady } = useAppContext();
  const sessionEpoch = useSessionEpoch();

  const params = useMemo(
    () => paramsOfAddress(location.search),
    [location.search],
  );

  const query = useTasks({
    page: params['page'],
    page_size: params['page_size'],
    sort: single(params['sort']),
    name__contains: single(params['name__contains']),
    state: single(params['state']),
  });
  const cancelTask = useCancelTask();

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [purgeTaskModalVisible, setPurgeTaskModalVisible] = useState(false);
  const [orphanCleanupTaskModalVisible, setOrphanCleanupTaskModalVisible] =
    useState(false);
  const [repairTaskModalVisible, setRepairTaskModalVisible] = useState(false);
  const [purgeTask, setPurgeTask] = useState(() => {
    const today = new Date();
    return {
      finished_before: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
      states: ['completed'],
    };
  });
  const [orphanCleanupTask, setOrphanCleanupTask] = useState({
    orphan_protection_time: ORPHAN_PROTECTION_TIME,
  });
  const [repairTask, setRepairTask] = useState({ verify_checksums: true });

  const addAlert = (alert: AlertType) =>
    setAlerts((current) => [...current, alert]);

  // What the server lists for each running or waiting task, read when the
  // change permission is not held on every task.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const [objectPermissions] = useState(
    () => new ObjectPermissions(() => rerender()),
  );
  useEffect(() => () => objectPermissions.dispose(), [objectPermissions]);

  // The same user signed in again: roles may have changed with the new
  // session, so what was read per task is forgotten. The list itself is read
  // again by the query layer, keeping the rows on screen until the answer
  // arrives.
  const lastEpoch = useRef(sessionEpoch);
  useEffect(() => {
    if (lastEpoch.current !== sessionEpoch) {
      lastEpoch.current = sessionEpoch;
      objectPermissions.reset();
    }
  }, [sessionEpoch, objectPermissions]);

  const rows = query.data?.results;
  const items = useMemo(() => rows ?? [], [rows]);

  // Reads the permissions of each task a Stop task button could be drawn for,
  // once, when the account's global permissions are known and do not already
  // include the change permission. Asking again is cheap: a task already read
  // or read a moment ago is left alone.
  useEffect(() => {
    if (!permissionsReady || hasPermission(CHANGE_TASK)) {
      return;
    }

    for (const item of items) {
      if (
        STOPPABLE.includes(item.state) &&
        !Array.isArray(item.my_permissions)
      ) {
        objectPermissions.read(item.pulp_href);
      }
    }
  });

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A failed read of rows already on screen keeps the rows and says so once.
  const alertedFailure = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded && status !== 403;
  useEffect(() => {
    if (rereadFailed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      addAlert({
        variant: 'danger',
        title: t`Tasks list could not be displayed.`,
        description: requestErrorDescription(query.error),
      });
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  const updateParams = (next) =>
    navigate({ search: '?' + ParamHelper.getQueryString(next) });

  const stopSelectedTask = () => {
    if (!selectedTask || cancelTask.isPending) {
      return;
    }
    const name = translateTask(selectedTask.name);

    cancelTask.mutate(selectedTask.pulp_href, {
      onSuccess: () => {
        setSelectedTask(null);
        addAlert({
          variant: 'success',
          title: name,
          description: t`Task "${name}" stopped successfully.`,
        });
      },
      onError: (e) => {
        setSelectedTask(null);
        // The session ended: the sign-in dialog explains it. The task was not
        // stopped and nothing is repeated.
        if (isSessionEnd(e)) {
          return;
        }
        addAlert({
          variant: 'danger',
          title: t`Task "${name}" could not be stopped.`,
          description: requestErrorDescription(e),
        });
      },
    });
  };

  const startMaintenance = (
    start: () => Promise<unknown>,
    started: string,
    failed: string,
  ) => {
    start()
      .then(() => addAlert({ variant: 'success', title: started }))
      .catch((e) => {
        if (!isSessionEnd(e)) {
          addAlert({ variant: 'danger', title: failed });
        }
      });
  };

  const noData =
    items.length === 0 && !filterIsSet(params, ['name__contains', 'state']);

  // Which maintenance actions are drawn is presentation only; Pulp decides
  // every request. Orphan cleanup and repair are for administrators, purge
  // for an account that may delete every task. Nothing is drawn while the
  // permissions are unknown.
  const canPurge = hasPermission('core.delete_task');

  const header = <BaseHeader title={t`Task management`} />;

  const stopModal = (task: Task) => {
    const name = translateTask(task.name);

    return (
      <ConfirmModal
        cancelAction={() => setSelectedTask(null)}
        title={t`Stop task?`}
        confirmAction={stopSelectedTask}
        confirmButtonTitle={t`Yes, stop`}
      >{t`${name} will be cancelled.`}</ConfirmModal>
    );
  };

  const modals = (
    <>
      {selectedTask ? stopModal(selectedTask) : null}
      {purgeTaskModalVisible ? (
        <PurgeTaskModal
          taskValue={purgeTask}
          cancelAction={() => setPurgeTaskModalVisible(false)}
          confirmAction={() => {
            startMaintenance(
              () => TaskPurgeAPI.create(purgeTask),
              t`Purge tasks started`,
              t`Purge tasks could not be started`,
            );
            setPurgeTaskModalVisible(false);
          }}
          updateTask={setPurgeTask}
        ></PurgeTaskModal>
      ) : null}
      {orphanCleanupTaskModalVisible ? (
        <OrphanCleanupTaskModal
          taskValue={orphanCleanupTask}
          cancelAction={() => setOrphanCleanupTaskModalVisible(false)}
          confirmAction={() => {
            startMaintenance(
              () => OrphanCleanupAPI.create(orphanCleanupTask),
              t`Orphan cleanup started`,
              t`Orphan cleanup could not be started`,
            );
            setOrphanCleanupTaskModalVisible(false);
          }}
          updateTask={setOrphanCleanupTask}
        ></OrphanCleanupTaskModal>
      ) : null}
      {repairTaskModalVisible ? (
        <RepairTaskModal
          taskValue={repairTask}
          cancelAction={() => setRepairTaskModalVisible(false)}
          confirmAction={() => {
            startMaintenance(
              () => RepairAPI.create(repairTask),
              t`Repair artifact storage started`,
              t`Repair artifact storage could not be started`,
            );
            setRepairTaskModalVisible(false);
          }}
          updateTask={setRepairTask}
        ></RepairTaskModal>
      ) : null}
    </>
  );

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // A refused read is not a failure to retry: the account is told it may not
  // view the page, with Pulp's own reason.
  if (status === 403) {
    return (
      <>
        {alertList}
        {header}
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  const failed =
    query.isError && !sessionEnded && !query.data && !query.isFetching;
  const loading = !query.data && !failed;

  if (query.data && noData) {
    return (
      <>
        {alertList}
        {modals}
        {header}
        <EmptyStateNoData
          title={t`No tasks yet`}
          description={t`Tasks will appear once created.`}
        />
      </>
    );
  }

  const sortTableOptions = {
    headers: [
      { title: t`Task name`, type: 'alpha', id: 'name' },
      { title: t`Description`, type: 'none', id: 'description' },
      { title: t`Created on`, type: 'numeric', id: 'pulp_created' },
      { title: t`Started at`, type: 'numeric', id: 'started_at' },
      { title: t`Finished at`, type: 'numeric', id: 'finished_at' },
      { title: t`Status`, type: 'alpha', id: 'state' },
    ],
  };

  const stopButton = (item: Task) =>
    STOPPABLE.includes(item.state) &&
    objectPermissions.holds(CHANGE_TASK, item, hasPermission) ? (
      <Button
        variant='secondary'
        key='stop'
        onClick={() => setSelectedTask(item)}
      >
        {t`Stop task`}
      </Button>
    ) : null;

  const renderRow = (item: Task) => {
    const { name, state, pulp_created, started_at, finished_at, pulp_href } =
      item;
    const taskId = parsePulpIDFromURL(pulp_href);
    const description = translateTask(name);

    return (
      <Tr key={pulp_href}>
        <Td>
          <Link to={formatPath(Paths.core.task.detail, { task: taskId })}>
            {name}
          </Link>
        </Td>
        <Td>{description !== name ? description : null}</Td>
        <Td>
          <DateComponent date={pulp_created} />
        </Td>
        <Td>
          <DateComponent date={started_at} />
        </Td>
        <Td>
          <DateComponent date={finished_at} />
        </Td>
        <Td>
          <StatusIndicator status={state as TaskStatus} />
        </Td>
        <Td>{stopButton(item)}</Td>
      </Tr>
    );
  };

  const body = () => {
    if (failed) {
      return (
        <ListErrorState
          title={t`Tasks list could not be displayed.`}
          message={requestErrorDescription(query.error)}
          onRetry={() => query.refetch()}
        />
      );
    }
    if (items.length === 0) {
      return <EmptyStateFilter />;
    }

    return (
      <Table aria-label={t`Task list`}>
        <SortTable
          options={sortTableOptions}
          params={params}
          updateParams={updateParams}
        />
        <Tbody>{items.map(renderRow)}</Tbody>
      </Table>
    );
  };

  return (
    <>
      {alertList}
      {modals}
      {header}
      <Main>
        {loading ? (
          <LoadingSpinner />
        ) : (
          <section className='pulp-section'>
            <div className='pulp-toolbar'>
              <Toolbar>
                <ToolbarContent>
                  <ToolbarGroup>
                    <ToolbarItem>
                      <CompoundFilter
                        inputText={inputText}
                        onChange={setInputText}
                        updateParams={updateParams}
                        params={params}
                        filterConfig={[
                          { id: 'name__contains', title: t`Task name` },
                          {
                            id: 'state',
                            title: t`Status`,
                            inputType: 'select',
                            options: [
                              { id: 'completed', title: t`Completed` },
                              { id: 'failed', title: t`Failed` },
                              { id: 'running', title: t`Running` },
                              { id: 'waiting', title: t`Waiting` },
                            ],
                          },
                        ]}
                      />
                    </ToolbarItem>
                    {isStaff ? (
                      <ToolbarItem>
                        <Button
                          variant={'primary'}
                          onClick={() => setOrphanCleanupTaskModalVisible(true)}
                        >{t`Orphan cleanup`}</Button>
                      </ToolbarItem>
                    ) : null}
                    {isStaff ? (
                      <ToolbarItem>
                        <Button
                          variant={'primary'}
                          onClick={() => setRepairTaskModalVisible(true)}
                        >{t`Repair`}</Button>
                      </ToolbarItem>
                    ) : null}
                    {canPurge ? (
                      <ToolbarItem>
                        <Button
                          variant={'primary'}
                          onClick={() => setPurgeTaskModalVisible(true)}
                        >{t`Purge tasks`}</Button>
                      </ToolbarItem>
                    ) : null}
                  </ToolbarGroup>
                </ToolbarContent>
              </Toolbar>
              {query.data ? (
                <PulpPagination
                  params={params}
                  updateParams={updateParams}
                  count={query.data.count}
                  isTop
                />
              ) : null}
            </div>
            <div>
              <AppliedFilters
                updateParams={(p) => {
                  updateParams(p);
                  setInputText('');
                }}
                params={params}
                ignoredParams={['page_size', 'page', 'sort', 'ordering']}
                niceNames={{
                  name__contains: t`Task name`,
                  state: t`Status`,
                }}
              />
            </div>
            {body()}
            {query.data ? (
              <PulpPagination
                params={params}
                updateParams={updateParams}
                count={query.data.count}
              />
            ) : null}
          </section>
        )}
      </Main>
    </>
  );
};

export default TaskListView;
