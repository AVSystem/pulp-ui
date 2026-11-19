import { t } from '@lingui/core/macro';
import {
  Button,
  DropdownItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  CompoundFilter,
  DeleteGroupModal,
  EmptyStateFilter,
  EmptyStateNoData,
  GroupModal,
  InsufficientPermissions,
  ListItemActions,
  LoadingSpinner,
  Main,
  PulpPagination,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { groupUrlId } from 'src/entities/core/group/href';
import { DEFAULT_PAGE_SIZE, type Group } from 'src/entities/core/group/model';
import {
  useCreateGroup,
  useDeleteGroup,
  useGroupMembers,
  useGroups,
} from 'src/entities/core/group/queries';
import { Paths, formatPath } from 'src/paths';
import { saveErrorMessages } from 'src/utilities/create-repository';
import { filterIsSet } from 'src/utilities/filter-is-set';
import {
  type ErrorMessagesType,
  mapErrorMessages,
} from 'src/utilities/map-error-messages';
import { ParamHelper } from 'src/utilities/param-helper';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

const DEFAULT_SORT = 'name';

const FILTERS = ['name__icontains'];

// How many affected users the delete dialog lists by name.
const MEMBERS_SHOWN = 10;

// The address holds the page, its size, the order and the filter; the screen
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

// What the create dialog shows for a failed save. A refusal says what was
// refused, Pulp's reason and whom to ask; any other answer is shown by field
// as the server gave it. The end of a session maps to nothing: the sign-in
// dialog explains it.
function createErrors(error: unknown): ErrorMessagesType {
  return requestErrorStatus(error) === 403
    ? saveErrorMessages(error)
    : mapErrorMessages(error);
}

const GroupList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    alerts: queuedAlerts,
    setAlerts: setQueuedAlerts,
    hasPermission,
  } = useAppContext();

  const params = useMemo(
    () => paramsOfAddress(location.search),
    [location.search],
  );

  const query = useGroups(
    {
      page: params['page'],
      page_size: params['page_size'],
      sort: single(params['sort']),
      name__icontains: single(params['name__icontains']),
    },
    { keep: 'other-page' },
  );
  const createGroup = useCreateGroup();
  const deleteGroup = useDeleteGroup();

  // What other screens queued for this one is shown once, then forgotten.
  const [alerts, setAlerts] = useState<AlertType[]>(() => queuedAlerts ?? []);
  useEffect(() => {
    setQueuedAlerts([]);
    // only at the first showing of the screen
  }, []);

  const [inputText, setInputText] = useState('');
  const [createVisible, setCreateVisible] = useState(false);
  const [groupError, setGroupError] = useState<ErrorMessagesType | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<Group | null>(null);

  const addAlert = (alert: AlertType) =>
    setAlerts((current) => [...current, alert]);

  const items = useMemo(() => query.data?.results ?? [], [query.data]);

  const status = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);

  // A failed read of rows already on screen keeps the rows and says so once.
  const alertedFailure = useRef(0);
  const rereadFailed = query.isRefetchError && !sessionEnded && status !== 403;
  useEffect(() => {
    if (rereadFailed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title: t`Groups list could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  // The users a deletion would affect are the members of the group, read only
  // for the dialog that is open and only by someone who may see users.
  const canViewUsers = hasPermission('auth.view_user');
  const members = useGroupMembers(groupToDelete?.pulp_href ?? null, {
    limit: MEMBERS_SHOWN,
    enabled: canViewUsers,
  });

  // A failed read of the members closes the dialog and says so once. The end
  // of a session keeps it: the sign-in dialog explains it and the members are
  // read again after signing in.
  const membersFailed = members.isError && !isSessionEnd(members.error);
  const alertedMembers = useRef(0);
  useEffect(() => {
    if (membersFailed && alertedMembers.current !== members.errorUpdatedAt) {
      alertedMembers.current = members.errorUpdatedAt;
      setGroupToDelete(null);
      addAlert({
        variant: 'danger',
        title: t`Users list could not be displayed.`,
        description: requestErrorDescription(members.error),
      });
    }
  }, [membersFailed, members.errorUpdatedAt, members.error]);

  const updateParams = (next) =>
    navigate({ search: '?' + ParamHelper.getQueryString(next) });

  const header = <BaseHeader title={t`Groups`} />;

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  // A refused read is not a failure to retry: the user is told they may not
  // view the list, with Pulp's own reason.
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
  const noData =
    !!query.data && items.length === 0 && !filterIsSet(params, FILTERS);

  const saveGroup = async (name: string) => {
    if (createGroup.isPending) {
      return;
    }
    try {
      const created = await createGroup.mutateAsync({ name });
      const urlId = groupUrlId(created.pulp_href);
      setCreateVisible(false);
      if (urlId) {
        navigate(formatPath(Paths.core.group.detail, { group: urlId }));
      }
    } catch (error) {
      // The session ended: nothing was created and nothing is repeated; the
      // dialog stays with what was typed.
      if (!isSessionEnd(error)) {
        setGroupError(createErrors(error));
      }
    }
  };

  const confirmDelete = async (group: Group) => {
    if (deleteGroup.isPending) {
      return;
    }
    try {
      await deleteGroup.mutateAsync({ href: group.pulp_href });
    } catch (error) {
      // The session ended: nothing was deleted and nothing is repeated.
      if (!isSessionEnd(error)) {
        addAlert({
          variant: 'danger',
          title: t`Error deleting group.`,
          description: requestErrorDescription(error),
        });
      }
      return;
    }
    setGroupToDelete(null);
    addAlert({
      variant: 'success',
      title: t`Group "${group.name}" has been successfully deleted.`,
    });
  };

  const createButton = hasPermission('core.add_group') && (
    <Button variant='primary' onClick={() => setCreateVisible(true)}>
      {t`Create`}
    </Button>
  );

  const renderTable = () => {
    if (failed) {
      return (
        <ListErrorState
          title={t`Groups list could not be displayed.`}
          message={requestErrorDescription(query.error)}
          onRetry={() => query.refetch()}
        />
      );
    }

    if (items.length === 0) {
      return <EmptyStateFilter />;
    }

    const sortTableOptions = {
      headers: [
        {
          title: t`Group name`,
          type: 'alpha',
          id: 'name',
        },
        {
          title: '',
          type: 'none',
          id: 'kebab',
        },
      ],
    };

    return (
      <Table aria-label={t`Group list`}>
        <SortTable
          options={sortTableOptions}
          params={params}
          updateParams={updateParams}
        />
        <Tbody>{items.map((group) => renderTableRow(group))}</Tbody>
      </Table>
    );
  };

  const renderTableRow = (group: Group) => {
    const urlId = groupUrlId(group.pulp_href);
    const dropdownItems = [
      hasPermission('core.delete_group') && (
        <DropdownItem
          aria-label='Delete'
          key='delete'
          onClick={() => setGroupToDelete(group)}
        >
          {t`Delete`}
        </DropdownItem>
      ),
    ];

    return (
      <Tr data-cy={`GroupList-row-${group.name}`} key={group.pulp_href}>
        <Td>
          {urlId ? (
            <Link to={formatPath(Paths.core.group.detail, { group: urlId })}>
              {group.name}
            </Link>
          ) : (
            group.name
          )}
        </Td>
        <ListItemActions kebabItems={dropdownItems} />
      </Tr>
    );
  };

  return (
    <>
      {alertList}
      {createVisible ? (
        <GroupModal
          onCancel={() => {
            setCreateVisible(false);
            setGroupError(null);
          }}
          onSave={saveGroup}
          clearErrors={() => setGroupError(null)}
          errorMessage={groupError}
        />
      ) : null}
      {groupToDelete ? (
        <DeleteGroupModal
          count={members.data?.count}
          cancelAction={() => setGroupToDelete(null)}
          deleteAction={() => confirmDelete(groupToDelete)}
          isDeleting={deleteGroup.isPending}
          name={groupToDelete.name}
          users={members.data?.results}
          canViewUsers={canViewUsers}
        />
      ) : null}
      {header}
      {loading ? (
        <LoadingSpinner />
      ) : noData ? (
        <EmptyStateNoData
          title={t`No groups yet`}
          description={t`Groups will appear once created`}
          button={createButton}
        />
      ) : (
        <Main>
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
                          {
                            id: 'name__icontains',
                            title: t`Group name`,
                          },
                        ]}
                      />
                    </ToolbarItem>
                  </ToolbarGroup>
                  {hasPermission('core.add_group') && (
                    <ToolbarGroup>
                      <ToolbarItem>
                        <Button
                          onClick={() => setCreateVisible(true)}
                        >{t`Create`}</Button>
                      </ToolbarItem>
                    </ToolbarGroup>
                  )}
                </ToolbarContent>
              </Toolbar>

              <PulpPagination
                params={params}
                updateParams={updateParams}
                count={query.data?.count ?? 0}
                isTop
              />
            </div>
            <div>
              <AppliedFilters
                updateParams={(p) => {
                  updateParams(p);
                  setInputText('');
                }}
                params={params}
                ignoredParams={['page_size', 'page', 'sort']}
                niceNames={{
                  name__icontains: t`Group name`,
                }}
              />
            </div>
            {renderTable()}

            <PulpPagination
              params={params}
              updateParams={updateParams}
              count={query.data?.count ?? 0}
            />
          </section>
        </Main>
      )}
    </>
  );
};

export default GroupList;
