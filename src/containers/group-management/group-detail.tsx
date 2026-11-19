import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  Button,
  DropdownItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Tbody, Td, Tr } from '@patternfly/react-table';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  Breadcrumbs,
  CompoundFilter,
  DeleteGroupModal,
  DeleteModal,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  LinkTabs,
  ListErrorState,
  ListItemActions,
  LoadingPage,
  LoadingSpinner,
  Main,
  NotFound,
  PulpPagination,
  SortTable,
  Table,
  Typeahead,
  closeAlert,
} from 'src/components';
import { groupHref } from 'src/entities/core/group/href';
import type { Group, GroupMember } from 'src/entities/core/group/model';
import {
  useAddGroupMembers,
  useAllGroupMemberNames,
  useDeleteGroup,
  useGroup,
  useGroupMemberList,
  useGroupMembers,
  useRemoveGroupMember,
} from 'src/entities/core/group/queries';
import { useUsers } from 'src/entities/core/user/queries';
import { Paths, formatPath } from 'src/paths';
import { ParamHelper, filterIsSet } from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import GroupDetailRoleManagement from './group-detail-role-management/group-detail-role-management';

// Names the add-users dialog by its visible title.
const ADD_USER_MODAL_TITLE_ID = 'add-user-modal-title';

// The queries of the user list that belong to this screen and not to the
// roles tab, which reads its own filters.
const USER_QUERY_PARAMS = ['username', 'first_name', 'last_name', 'email'];

// How many affected users the delete dialog lists by name.
const MEMBERS_SHOWN = 10;

const DEFAULT_PAGE_SIZE = 10;

// The address holds the tab, the page, its size, the order and the filters; the
// screen shows exactly what the address says, and a change goes through the
// address.
function paramsOfAddress(search: string) {
  const params = ParamHelper.parseParamString(search, ['page', 'page_size']);
  const tab = params['tab'] || 'access';

  return {
    ...params,
    page_size: params['page_size'] || DEFAULT_PAGE_SIZE,
    sort: params['sort'] || (tab === 'access' ? 'role' : 'username'),
    tab,
  };
}

// A parameter that came in more than once is read as its first value.
function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === null ? undefined : String(first);
}

// The address holds the id of one group. Another group is another screen: what
// the one left behind showed, its alerts and its open dialogs go with it.
const GroupDetail = () => {
  const { group: urlId } = useParams();

  return <GroupDetailScreen key={urlId} urlId={urlId} />;
};

const GroupDetailScreen = ({ urlId }: { urlId: string }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, queueAlert } = useAppContext();

  const params = useMemo(
    () => paramsOfAddress(location.search),
    [location.search],
  );

  // The id of the address becomes an address of the API only here; an id that
  // is not one names no group and asks for nothing.
  const href = groupHref(urlId);

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [inputText, setInputText] = useState('');
  const [addVisible, setAddVisible] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<GroupMember | null>(
    null,
  );
  // True once the group has been deleted: nothing is read of it any more.
  const [deleted, setDeleted] = useState(false);

  const deleteGroup = useDeleteGroup();
  const removeMember = useRemoveGroupMember();

  // A group that is being deleted, or is gone, is not read again: the answer
  // could only be a failure, shown for a moment before the screen moves on.
  const leaving = deleteGroup.isPending || deleted;

  const groupQuery = useGroup(href, { enabled: !leaving });
  const group = groupQuery.data;

  const onUsersTab = params.tab === 'users';
  const membersQuery = useGroupMemberList(
    href,
    {
      page: params['page'] as number | undefined,
      page_size: params['page_size'] as number,
      sort: single(params['sort']),
      username: single(params['username']),
    },
    { enabled: !!group && onUsersTab && !leaving },
  );

  // The users a deletion would affect are the members of the group, read only
  // for the dialog that is open and only by someone who may see users.
  const mayViewUsers = hasPermission('auth.view_user');
  const affected = useGroupMembers(href, {
    limit: MEMBERS_SHOWN,
    enabled: showDeleteModal && mayViewUsers && !leaving,
  });

  const addAlert = (alert: AlertType) =>
    setAlerts((current) => [...current, alert]);

  // The group on screen is never replaced by the failure of a later read: it
  // stays, and the failure is reported next to it, once.
  const groupStatus = groupQuery.isError
    ? requestErrorStatus(groupQuery.error)
    : null;
  const groupSessionEnded =
    groupQuery.isError && isSessionEnd(groupQuery.error);
  const alertedGroup = useRef(0);
  const groupRereadFailed = groupQuery.isRefetchError && !groupSessionEnded;
  useEffect(() => {
    if (
      groupRereadFailed &&
      alertedGroup.current !== groupQuery.errorUpdatedAt
    ) {
      alertedGroup.current = groupQuery.errorUpdatedAt;
      addAlert({
        variant: 'danger',
        title: t`Group could not be displayed.`,
        description: requestErrorDescription(groupQuery.error),
      });
    }
  }, [groupRereadFailed, groupQuery.errorUpdatedAt, groupQuery.error]);

  // A failed read of the members is reported once, whether it left the tab
  // with nothing to show or only failed to refresh what is shown. A refusal
  // with nothing to show is not an alert: the tab says so itself.
  const membersStatus = membersQuery.isError
    ? requestErrorStatus(membersQuery.error)
    : null;
  const membersSessionEnded =
    membersQuery.isError && isSessionEnd(membersQuery.error);
  const membersRefused = membersStatus === 403 && !membersQuery.data;
  const membersFailed =
    membersQuery.isError && !membersSessionEnded && !membersRefused;
  const alertedMembers = useRef(0);
  useEffect(() => {
    if (
      membersFailed &&
      alertedMembers.current !== membersQuery.errorUpdatedAt
    ) {
      alertedMembers.current = membersQuery.errorUpdatedAt;
      addAlert({
        variant: 'danger',
        title: t`Users list could not be displayed.`,
        description: requestErrorDescription(membersQuery.error),
      });
    }
  }, [membersFailed, membersQuery.errorUpdatedAt, membersQuery.error]);

  // A failed read of the affected users closes the delete dialog and says so
  // once; a refusal keeps it, with the warning that the users cannot be shown.
  // The end of a session keeps it too: the sign-in dialog explains it and the
  // users are read again after signing in.
  const affectedRefused =
    affected.isError && requestErrorStatus(affected.error) === 403;
  const affectedFailed =
    affected.isError && !isSessionEnd(affected.error) && !affectedRefused;
  const alertedAffected = useRef(0);
  useEffect(() => {
    if (affectedFailed && alertedAffected.current !== affected.errorUpdatedAt) {
      alertedAffected.current = affected.errorUpdatedAt;
      setShowDeleteModal(false);
      addAlert({
        variant: 'danger',
        title: t`Users list could not be displayed.`,
        description: requestErrorDescription(affected.error),
      });
    }
  }, [affectedFailed, affected.errorUpdatedAt, affected.error]);

  const updateParams = (next) =>
    navigate({ search: '?' + ParamHelper.getQueryString(next) });

  const alertList = (
    <AlertList
      alerts={alerts}
      closeAlert={(i) => closeAlert(i, { alerts, setAlerts })}
    />
  );

  if (href === null || (!group && groupStatus === 404)) {
    return <NotFound />;
  }

  // A refused read is not a failure to retry: the user is told they may not
  // view the group, with Pulp's own reason.
  if (!group && groupStatus === 403) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Insufficient permissions`} />
        <InsufficientPermissions
          detail={requestErrorDetail(groupQuery.error)}
        />
      </>
    );
  }

  if (
    !group &&
    groupQuery.isError &&
    !groupSessionEnded &&
    !groupQuery.isFetching
  ) {
    return (
      <>
        {alertList}
        <BaseHeader title={t`Groups`} />
        <Main>
          <ListErrorState
            title={t`Group could not be displayed.`}
            message={requestErrorDescription(groupQuery.error)}
            onRetry={() => groupQuery.refetch()}
          />
        </Main>
      </>
    );
  }

  if (!group) {
    return (
      <>
        {alertList}
        <LoadingPage />
      </>
    );
  }

  const confirmDelete = async () => {
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
          title: t`Group "${group.name}" could not be deleted.`,
          description: requestErrorDescription(error),
        });
      }
      return;
    }
    setDeleted(true);
    setShowDeleteModal(false);
    queueAlert({
      title: t`Group "${group.name}" has been successfully deleted.`,
      variant: 'success',
    });
    navigate(formatPath(Paths.core.group.list));
  };

  const confirmRemove = async (member: GroupMember) => {
    if (removeMember.isPending) {
      return;
    }
    const { name } = group;
    try {
      await removeMember.mutateAsync({ href, member: member.pulp_href });
    } catch (error) {
      // The session ended: nothing was removed and nothing is repeated; the
      // confirmation stays so that the user can remove after signing in.
      if (!isSessionEnd(error)) {
        addAlert({
          variant: 'danger',
          title: t`User "${member.username}" could not be removed from group "${name}".`,
          description: requestErrorDescription(error),
        });
      }
      return;
    }
    setMemberToRemove(null);
    addAlert({
      variant: 'success',
      title: t`User "${member.username}" has been successfully removed from group "${name}".`,
    });
  };

  const tabs = [
    {
      active: params.tab === 'access',
      title: t`Access`,
      link: formatPath(
        Paths.core.group.detail,
        { group: urlId },
        { tab: 'access' },
      ),
    },
    hasPermission('auth.view_user') && {
      active: params.tab === 'users',
      title: t`Users`,
      link: formatPath(
        Paths.core.group.detail,
        { group: urlId },
        { tab: 'users' },
      ),
    },
  ];

  const renderUsersTab = () => {
    const members = membersQuery.data;
    const failed =
      membersQuery.isError &&
      !membersSessionEnded &&
      !members &&
      !membersQuery.isFetching;

    if (failed) {
      return (
        <ListErrorState
          title={t`Users list could not be displayed.`}
          message={requestErrorDescription(membersQuery.error)}
          onRetry={() => membersQuery.refetch()}
        />
      );
    }

    if (!members) {
      return <LoadingSpinner />;
    }

    const itemCount = members.count;
    const noData = itemCount === 0 && !filterIsSet(params, ['username']);

    if (noData) {
      return (
        <EmptyStateNoData
          title={t`No users yet`}
          description={t`Users will appear once added to this group`}
          button={
            hasPermission('core.change_group') && (
              <Button variant='primary' onClick={() => setAddVisible(true)}>
                {t`Add`}
              </Button>
            )
          }
        />
      );
    }

    return (
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
                        id: 'username',
                        title: t`Username`,
                      },
                    ]}
                  />
                </ToolbarItem>
              </ToolbarGroup>
              {hasPermission('core.change_group') && (
                <ToolbarGroup>
                  <ToolbarItem>
                    <Button onClick={() => setAddVisible(true)}>
                      {t`Add`}
                    </Button>
                  </ToolbarItem>
                </ToolbarGroup>
              )}
            </ToolbarContent>
          </Toolbar>

          <PulpPagination
            params={params}
            updateParams={updateParams}
            count={itemCount}
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
            ignoredParams={[
              'id',
              'page',
              'page_size',
              'sort',
              'tab',
              'role__icontains',
            ]}
          />
        </div>
        {renderUsersTable(members.results)}
        <div style={{ paddingTop: '24px', paddingBottom: '8px' }}>
          <PulpPagination
            params={params}
            updateParams={updateParams}
            count={itemCount}
          />
        </div>{' '}
      </section>
    );
  };

  const renderUsersTable = (members: GroupMember[]) => {
    if (members.length === 0) {
      return <EmptyStateFilter />;
    }

    const sortTableOptions = {
      headers: [
        {
          title: t`Username`,
          type: 'alpha',
          id: 'username',
        },
      ],
    };

    return (
      <Table aria-label={t`User list`}>
        <SortTable
          options={sortTableOptions}
          params={params}
          updateParams={updateParams}
        />
        <Tbody>{members.map((member) => renderTableRow(member))}</Tbody>
      </Table>
    );
  };

  const renderTableRow = (member: GroupMember) => {
    const dropdownItems = [
      hasPermission('core.change_group') && (
        <DropdownItem key='delete' onClick={() => setMemberToRemove(member)}>
          {t`Remove`}
        </DropdownItem>
      ),
    ];
    return (
      <Tr
        data-cy={`GroupDetail-users-${member.username}`}
        key={member.username}
      >
        <Td>{member.username}</Td>
        <ListItemActions kebabItems={dropdownItems} />
      </Tr>
    );
  };

  const renderRemoveModal = (member: GroupMember) => {
    const { username } = member;
    const groupname = group.name;

    return (
      <DeleteModal
        cancelAction={() => setMemberToRemove(null)}
        deleteAction={() => confirmRemove(member)}
        isDisabled={removeMember.isPending}
        spinner={removeMember.isPending}
        title={t`Remove user from group?`}
      >
        <Trans>
          User <b>{username}</b> will be removed from group <b>{groupname}</b>.
        </Trans>
      </DeleteModal>
    );
  };

  return (
    <>
      {alertList}
      {addVisible ? (
        <AddMembersModal
          group={group}
          addAlert={addAlert}
          close={() => setAddVisible(false)}
        />
      ) : null}
      {showDeleteModal ? (
        <DeleteGroupModal
          count={affected.data?.count}
          cancelAction={() => setShowDeleteModal(false)}
          deleteAction={confirmDelete}
          isDeleting={deleteGroup.isPending}
          name={group.name}
          users={affected.data?.results}
          canViewUsers={mayViewUsers && !affectedRefused}
        />
      ) : null}
      {memberToRemove ? renderRemoveModal(memberToRemove) : null}
      <BaseHeader
        title={group.name}
        breadcrumbs={
          <Breadcrumbs
            links={[
              { url: formatPath(Paths.core.group.list), name: t`Groups` },
              { name: group.name },
            ]}
          />
        }
        pageControls={
          hasPermission('core.delete_group') ? (
            <ToolbarItem>
              <Button
                onClick={() => setShowDeleteModal(true)}
                variant='secondary'
              >
                {t`Delete`}
              </Button>
            </ToolbarItem>
          ) : null
        }
      >
        <div className='pulp-tab-link-container'>
          <div className='tabs'>
            <LinkTabs tabs={tabs} />
          </div>
        </div>
      </BaseHeader>
      {onUsersTab && membersRefused ? (
        <InsufficientPermissions
          detail={requestErrorDetail(membersQuery.error)}
        />
      ) : (
        <Main data-cy='main-tabs'>
          {params.tab == 'access' ? (
            <GroupDetailRoleManagement
              addAlert={(title, variant, description) =>
                addAlert({ title, variant, description })
              }
              canEdit={hasPermission('core.manage_roles_group')}
              group={group}
              nonQueryParams={USER_QUERY_PARAMS}
              params={params}
              updateParams={updateParams}
            />
          ) : null}
          {onUsersTab ? renderUsersTab() : null}
        </Main>
      )}
    </>
  );
};

interface IAddMembersProps {
  addAlert: (alert: AlertType) => void;
  close: () => void;
  group: Group;
}

// The dialog that adds users to the group. It shows once it knows both who is
// a member (every member, not the page the tab shows) and the users it can
// offer, and it reads both afresh each time it opens. A user is offered while
// they are not a member and not already picked.
const AddMembersModal = ({ addAlert, close, group }: IAddMembersProps) => {
  const names = useAllGroupMemberNames(group.pulp_href);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<{ id: string; name: string }[]>([]);
  const users = useUsers(
    { page_size: 1000, username__contains: search || undefined },
    { staleTime: 0 },
  );
  const addMembers = useAddGroupMembers();

  // The users of the last answer stay on offer while the answer to a newer
  // search is on its way.
  const [candidates, setCandidates] = useState<
    { pulp_href: string; username: string }[] | null
  >(null);
  useEffect(() => {
    if (users.data) {
      setCandidates(users.data.results);
    }
  }, [users.data]);

  // Without the members, or without any user, there is nothing to offer: the
  // dialog closes with one alert that says why, and Add tries again. A failed
  // search after the dialog has shown keeps it open.
  const namesFailed = names.isError && !isSessionEnd(names.error);
  const usersFailed = users.isError && !isSessionEnd(users.error);
  const failure = namesFailed
    ? names.error
    : usersFailed && candidates === null
      ? users.error
      : null;
  const reportedOpen = useRef(false);
  useEffect(() => {
    if (failure !== null && !reportedOpen.current) {
      reportedOpen.current = true;
      close();
      addAlert({
        variant: 'danger',
        title: t`Users list could not be displayed.`,
        description: requestErrorDescription(failure),
      });
    }
  }, [failure]);
  const alertedSearch = useRef(0);
  useEffect(() => {
    if (
      usersFailed &&
      candidates !== null &&
      alertedSearch.current !== users.errorUpdatedAt
    ) {
      alertedSearch.current = users.errorUpdatedAt;
      addAlert({
        variant: 'danger',
        title: t`Users list could not be displayed.`,
        description: requestErrorDescription(users.error),
      });
    }
  }, [usersFailed, candidates, users.errorUpdatedAt, users.error]);

  if (!names.data || candidates === null) {
    return null;
  }

  const members = new Set(names.data);
  const options = candidates
    .filter(
      (user) =>
        !members.has(user.username) &&
        !selected.some((pick) => pick.name === user.username),
    )
    .map((user) => ({ id: user.pulp_href, name: user.username }));

  const add = async () => {
    if (addMembers.isPending || selected.length === 0) {
      return;
    }
    const outcomes = await addMembers.mutateAsync({
      href: group.pulp_href,
      usernames: selected.map((pick) => pick.name),
    });

    // A user cut off by the end of the session stays picked, so the user can
    // add again after signing in; everyone else is settled.
    const cutOff = new Set<string>();
    for (const outcome of outcomes) {
      if (outcome.error === null) {
        addAlert({
          variant: 'success',
          title: t`User "${outcome.username}" has been successfully added to group "${group.name}".`,
        });
      } else if (isSessionEnd(outcome.error)) {
        cutOff.add(outcome.username);
      } else {
        addAlert({
          variant: 'danger',
          title: t`User "${outcome.username}" could not be added to group "${group.name}".`,
          description: requestErrorDescription(outcome.error),
        });
      }
    }

    if (cutOff.size > 0) {
      setSelected((current) => current.filter((pick) => cutOff.has(pick.name)));
    } else {
      close();
    }
  };

  return (
    <Modal
      variant='large'
      onClose={close}
      isOpen
      aria-labelledby={ADD_USER_MODAL_TITLE_ID}
    >
      <ModalHeader
        labelId={ADD_USER_MODAL_TITLE_ID}
        title={t`Add selected users to group`}
      />
      <ModalBody>
        <Typeahead
          results={options}
          loadResults={setSearch}
          onSelect={(_event, selection) => {
            const picked = options.find((option) => option.name === selection);
            setSelected((current) =>
              picked
                ? [...current, picked]
                : current.filter((pick) => pick.name !== selection),
            );
          }}
          placeholderText={t`Select users`}
          selections={selected}
          menuAppendTo={'parent'}
          multiple
          onClear={() => setSelected([])}
          style={{ overflowY: 'auto', maxHeight: '350px' }}
        />
      </ModalBody>
      <ModalFooter>
        <Button
          key='add'
          variant='primary'
          isDisabled={selected.length === 0 || addMembers.isPending}
          onClick={add}
        >
          {t`Add`}
        </Button>
        <Button key='cancel' variant='link' onClick={close}>
          {t`Cancel`}
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default GroupDetail;
