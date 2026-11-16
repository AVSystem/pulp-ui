import { t } from '@lingui/core/macro';
import {
  Button,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { Component } from 'react';
import { Link } from 'react-router';
import {
  OrphanCleanupAPI,
  RepairAPI,
  TaskAPI,
  TaskPurgeAPI,
  type TaskType,
} from 'src/api';
import { AppContext, type IAppContextType } from 'src/app-context';
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
import { Paths, formatPath } from 'src/paths';
import {
  ParamHelper,
  type RouteProps,
  filterIsSet,
  parsePulpIDFromURL,
  translateTask,
  withRouter,
} from 'src/utilities';
import { ObjectPermissions } from 'src/utilities/my-permissions';
import {
  isSessionEnd,
  requestErrorDescription,
} from 'src/utilities/request-error';
import './task.scss';

interface IState {
  params: {
    page?: number;
    page_size?: number;
  };
  loading: boolean;
  items: TaskType[];
  itemCount: number;
  alerts: AlertType[];
  cancelModalVisible: boolean;
  purgeTaskModalVisible: boolean;
  orphanCleanupTaskModalVisible: boolean;
  repairTaskModalVisible: boolean;
  selectedTask: TaskType;
  inputText: string;
  purgeTask: { finished_before: string; states: string[] };
  orphanCleanupTask: { orphan_protection_time: number };
  repairTask: { verify_checksums: boolean };
}

const ORPHAN_PROTECTION_TIME = 1440;
const CHANGE_TASK = 'core.change_task';
// the states a task can still be stopped in
const STOPPABLE = ['running', 'waiting'];

export class TaskListView extends Component<RouteProps, IState> {
  static contextType = AppContext;

  // What the server lists for each running or waiting task, read when the
  // change permission is not held on every task.
  private objectPermissions = new ObjectPermissions(() => this.forceUpdate());

  constructor(props) {
    super(props);

    const params = ParamHelper.parseParamString(props.location.search, [
      'page',
      'page_size',
    ]);

    if (!params['page_size']) {
      params['page_size'] = 10;
    }

    if (!params['sort']) {
      params['sort'] = '-pulp_created';
    }
    const today = new Date();

    this.state = {
      params,
      items: [],
      loading: true,
      itemCount: 0,
      alerts: [],
      cancelModalVisible: false,
      purgeTaskModalVisible: false,
      orphanCleanupTaskModalVisible: false,
      repairTaskModalVisible: false,
      selectedTask: null,
      inputText: '',
      purgeTask: {
        finished_before: `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`,
        states: ['completed'],
      },
      orphanCleanupTask: { orphan_protection_time: ORPHAN_PROTECTION_TIME },
      repairTask: { verify_checksums: true },
    };
  }

  componentDidMount() {
    this.queryTasks();
  }

  componentWillUnmount() {
    this.objectPermissions.dispose();
  }

  componentDidUpdate(prevProps: RouteProps) {
    // The same user signed in again: read the list again, keeping the rows on
    // screen until the answer arrives. Roles may have changed with the new
    // session.
    if (prevProps.sessionEpoch !== this.props.sessionEpoch) {
      this.objectPermissions.reset();
      this.queryTasks(true);
    }
    this.readObjectPermissions();
  }

  // Reads the permissions of each task a Stop task button could be drawn for,
  // once, when the account's global permissions are known and do not already
  // include the change permission.
  private readObjectPermissions() {
    const { hasPermission, permissionsReady } = this.context as IAppContextType;
    if (!permissionsReady || hasPermission(CHANGE_TASK)) {
      return;
    }

    for (const item of this.state.items) {
      if (
        STOPPABLE.includes(item.state) &&
        !Array.isArray(item.my_permissions)
      ) {
        this.objectPermissions.read(item.pulp_href);
      }
    }
  }

  render() {
    const {
      params,
      itemCount,
      loading,
      items,
      alerts,
      cancelModalVisible,
      purgeTaskModalVisible,
      orphanCleanupTaskModalVisible,
      repairTaskModalVisible,
    } = this.state;

    const noData =
      items.length === 0 && !filterIsSet(params, ['name__contains', 'state']);

    // Which maintenance actions are drawn is presentation only; Pulp decides
    // every request. Orphan cleanup and repair are for administrators, purge
    // for an account that may delete every task. Nothing is drawn while the
    // permissions are unknown.
    const { hasPermission, isStaff } = this.context as IAppContextType;
    const canPurge = hasPermission('core.delete_task');

    const orphansCleanup = (
      <Button
        variant={'primary'}
        onClick={() => this.setState({ orphanCleanupTaskModalVisible: true })}
      >{t`Orphan cleanup`}</Button>
    );
    const repair = (
      <Button
        variant={'primary'}
        onClick={() => this.setState({ repairTaskModalVisible: true })}
      >{t`Repair`}</Button>
    );

    const purgeTasks = (
      <Button
        variant={'primary'}
        onClick={() => this.setState({ purgeTaskModalVisible: true })}
      >{t`Purge tasks`}</Button>
    );

    return (
      <>
        <AlertList
          alerts={alerts}
          closeAlert={(i) =>
            closeAlert(i, {
              alerts,
              setAlerts: (alerts) => this.setState({ alerts }),
            })
          }
        />
        {cancelModalVisible ? this.renderCancelModal() : null}
        {purgeTaskModalVisible ? this.renderPurgeTaskModal() : null}
        {orphanCleanupTaskModalVisible
          ? this.renderOrphanCleanupTaskModal()
          : null}
        {repairTaskModalVisible ? this.renderRepairTaskModal() : null}
        <BaseHeader title={t`Task management`} />
        {noData && !loading ? (
          <EmptyStateNoData
            title={t`No tasks yet`}
            description={t`Tasks will appear once created.`}
          />
        ) : (
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
                            inputText={this.state.inputText}
                            onChange={(text) =>
                              this.setState({ inputText: text })
                            }
                            updateParams={(p) =>
                              this.updateParams(p, () => this.queryTasks())
                            }
                            params={params}
                            filterConfig={[
                              {
                                id: 'name__contains',
                                title: t`Task name`,
                              },
                              {
                                id: 'state',
                                title: t`Status`,
                                inputType: 'select',
                                options: [
                                  {
                                    id: 'completed',
                                    title: t`Completed`,
                                  },
                                  {
                                    id: 'failed',
                                    title: t`Failed`,
                                  },
                                  {
                                    id: 'running',
                                    title: t`Running`,
                                  },
                                  {
                                    id: 'waiting',
                                    title: t`Waiting`,
                                  },
                                ],
                              },
                            ]}
                          />
                        </ToolbarItem>
                        {isStaff ? (
                          <ToolbarItem>{orphansCleanup}</ToolbarItem>
                        ) : null}
                        {isStaff ? <ToolbarItem>{repair}</ToolbarItem> : null}
                        {canPurge ? (
                          <ToolbarItem>{purgeTasks}</ToolbarItem>
                        ) : null}
                      </ToolbarGroup>
                    </ToolbarContent>
                  </Toolbar>
                  <PulpPagination
                    params={params}
                    updateParams={(p) =>
                      this.updateParams(p, () => this.queryTasks())
                    }
                    count={itemCount}
                    isTop
                  />
                </div>
                <div>
                  <AppliedFilters
                    updateParams={(p) => {
                      this.updateParams(p, () => this.queryTasks());
                      this.setState({ inputText: '' });
                    }}
                    params={params}
                    ignoredParams={['page_size', 'page', 'sort', 'ordering']}
                    niceNames={{
                      name__contains: t`Task name`,
                      state: t`Status`,
                    }}
                  />
                </div>
                {loading ? <LoadingSpinner /> : this.renderTable(params)}

                <PulpPagination
                  params={params}
                  updateParams={(p) =>
                    this.updateParams(p, () => this.queryTasks())
                  }
                  count={itemCount}
                />
              </section>
            )}
          </Main>
        )}
      </>
    );
  }

  private renderTable(params) {
    const { items } = this.state;

    if (items.length === 0) {
      return <EmptyStateFilter />;
    }

    const sortTableOptions = {
      headers: [
        {
          title: t`Task name`,
          type: 'alpha',
          id: 'name',
        },
        {
          title: t`Description`,
          type: 'none',
          id: 'description',
        },
        {
          title: t`Created on`,
          type: 'numeric',
          id: 'pulp_created',
        },
        {
          title: t`Started at`,
          type: 'numeric',
          id: 'started_at',
        },
        {
          title: t`Finished at`,
          type: 'numeric',
          id: 'finished_at',
        },
        {
          title: t`Status`,
          type: 'alpha',
          id: 'state',
        },
      ],
    };

    return (
      <Table aria-label={t`Task list`}>
        <SortTable
          options={sortTableOptions}
          params={params}
          updateParams={(p) => this.updateParams(p, () => this.queryTasks())}
        />
        <Tbody>{items.map((item, i) => this.renderTableRow(item, i))}</Tbody>
      </Table>
    );
  }

  private renderTableRow(item, index: number) {
    const { name, state, pulp_created, started_at, finished_at, pulp_href } =
      item;
    const taskId = parsePulpIDFromURL(pulp_href);
    const description = translateTask(name);

    return (
      <Tr key={index}>
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
          <StatusIndicator status={state} />
        </Td>
        <Td>{this.cancelButton(state, item)}</Td>
      </Tr>
    );
  }

  private cancelButton(state, selectedTask) {
    const { hasPermission } = this.context as IAppContextType;
    if (
      !STOPPABLE.includes(state) ||
      !this.objectPermissions.holds(CHANGE_TASK, selectedTask, hasPermission)
    ) {
      return null;
    }

    return (
      <Button
        variant='secondary'
        key='stop'
        onClick={() =>
          this.setState({
            cancelModalVisible: true,
            selectedTask,
          })
        }
      >
        {t`Stop task`}
      </Button>
    );
  }

  private renderCancelModal() {
    const { selectedTask } = this.state;
    const name = translateTask(selectedTask.name);

    return (
      <ConfirmModal
        cancelAction={() => this.setState({ cancelModalVisible: false })}
        title={t`Stop task?`}
        confirmAction={() => this.selectedTask(selectedTask, name)}
        confirmButtonTitle={t`Yes, stop`}
      >{t`${name} will be cancelled.`}</ConfirmModal>
    );
  }
  private renderPurgeTaskModal() {
    const { purgeTask } = this.state;
    return (
      <PurgeTaskModal
        taskValue={purgeTask}
        cancelAction={() => this.setState({ purgeTaskModalVisible: false })}
        confirmAction={() => {
          this.purge(purgeTask);
          this.setState({ purgeTaskModalVisible: false });
        }}
        updateTask={(task) => {
          this.setState({ purgeTask: task });
        }}
      ></PurgeTaskModal>
    );
  }
  private renderOrphanCleanupTaskModal() {
    const { orphanCleanupTask } = this.state;

    return (
      <OrphanCleanupTaskModal
        taskValue={orphanCleanupTask}
        cancelAction={() =>
          this.setState({ orphanCleanupTaskModalVisible: false })
        }
        confirmAction={() => {
          this.orphanCleanup(orphanCleanupTask);
          this.setState({ orphanCleanupTaskModalVisible: false });
        }}
        updateTask={(task) => {
          this.setState({ orphanCleanupTask: task });
        }}
      ></OrphanCleanupTaskModal>
    );
  }
  private renderRepairTaskModal() {
    const { repairTask } = this.state;

    return (
      <RepairTaskModal
        taskValue={repairTask}
        cancelAction={() => this.setState({ repairTaskModalVisible: false })}
        confirmAction={() => {
          this.repair(repairTask);
          this.setState({ repairTaskModalVisible: false });
        }}
        updateTask={(task) => this.setState({ repairTask: task })}
      ></RepairTaskModal>
    );
  }

  private selectedTask({ pulp_href }, name) {
    TaskAPI.patch(parsePulpIDFromURL(pulp_href), {
      state: 'canceled',
    })
      .then(() => {
        this.setState({
          loading: true,
          selectedTask: null,
          cancelModalVisible: false,
          alerts: [
            ...this.state.alerts,
            {
              variant: 'success',
              title: name,
              description: t`Task "${name}" stopped successfully.`,
            },
          ],
        });
        this.queryTasks();
      })
      .catch((e) => {
        // The session ended: the sign-in dialog explains it. The task was not
        // stopped and nothing is repeated.
        if (isSessionEnd(e)) {
          this.setState({ cancelModalVisible: false });
          return;
        }
        this.setState({
          cancelModalVisible: false,
          alerts: [
            ...this.state.alerts,
            {
              variant: 'danger',
              title: t`Task "${name}" could not be stopped.`,
              description: requestErrorDescription(e),
            },
          ],
        });
        // The rows stay on screen while the list is read again.
        this.queryTasks(true);
      });
  }

  // A quiet read keeps the rows on screen instead of showing the spinner.
  private queryTasks(quiet = false) {
    this.setState({ loading: quiet ? this.state.loading : true }, () => {
      TaskAPI.list(this.state.params)
        .then((result) => {
          this.setState({
            items: result.data.results,
            itemCount: result.data.count,
            loading: false,
          });
        })
        .catch((e) => {
          // The session ended: the sign-in dialog explains it, and the list
          // keeps its spinner or its rows until it reads again.
          if (isSessionEnd(e)) {
            return;
          }
          this.setState({
            loading: false,
            items: [],
            itemCount: 0,
            alerts: [
              ...this.state.alerts,
              {
                variant: 'danger',
                title: t`Tasks list could not be displayed.`,
                description: requestErrorDescription(e),
              },
            ],
          });
        });
    });
  }

  private addAlert(title, variant, description?) {
    this.setState({
      alerts: [
        ...this.state.alerts,
        {
          description,
          title,
          variant,
        },
      ],
    });
  }

  private orphanCleanup(task: { orphan_protection_time: number }) {
    OrphanCleanupAPI.create(task)
      .then(() => {
        this.addAlert(t`Orphan cleanup started`, 'success');
        this.queryTasks();
      })
      .catch((e) => {
        if (!isSessionEnd(e)) {
          this.addAlert(t`Orphan cleanup could not be started`, 'danger');
        }
      });
  }

  private repair(task: { verify_checksums: boolean }) {
    RepairAPI.create(task)
      .then(() => {
        this.addAlert(t`Repair artifact storage started`, 'success');
        this.queryTasks();
      })
      .catch((e) => {
        if (!isSessionEnd(e)) {
          this.addAlert(
            t`Repair artifact storage could not be started`,
            'danger',
          );
        }
      });
  }

  private purge(task: { finished_before: string; states: string[] }) {
    TaskPurgeAPI.create(task)
      .then(() => {
        this.addAlert(t`Purge tasks started`, 'success');
        this.queryTasks();
      })
      .catch((e) => {
        if (!isSessionEnd(e)) {
          this.addAlert(t`Purge tasks could not be started`, 'danger');
        }
      });
  }

  private updateParams(params, callback = null) {
    ParamHelper.updateParams({
      params,
      navigate: (to) => this.props.navigate(to),
      setState: (state) => this.setState(state, callback),
    });
  }
}

export default withRouter(TaskListView);
