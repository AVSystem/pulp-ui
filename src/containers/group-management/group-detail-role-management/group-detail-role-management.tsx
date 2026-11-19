import { t } from '@lingui/core/macro';
import { Trans } from '@lingui/react/macro';
import {
  Button,
  DropdownItem,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import { Td } from '@patternfly/react-table';
import {
  type FunctionComponent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { type RoleType } from 'src/api';
import {
  AppliedFilters,
  CompoundFilter,
  DeleteModal,
  EmptyStateFilter,
  EmptyStateNoData,
  ExpandableRow,
  InsufficientPermissions,
  ListErrorState,
  ListItemActions,
  LoadingPage,
  PermissionCategories,
  PreviewRoles,
  PulpPagination,
  RoleListTable,
  SelectRoles,
  WizardModal,
} from 'src/components';
import {
  type GroupRole,
  type GroupRoleListParams,
} from 'src/entities/core/group-role/model';
import {
  useAddGroupRoles,
  useGroupRoles,
  useRemoveGroupRole,
} from 'src/entities/core/group-role/queries';
import {
  ParamHelper,
  type ParamType,
  filterIsSet,
  translateLockedRole,
} from 'src/utilities';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import './group-detail-role-management.scss';

// A parameter that came in more than once is read as its first value.
function single(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined || first === null ? undefined : String(first);
}

interface IProps {
  addAlert: (title, variant, description?) => void;
  canEdit: boolean;
  // the group whose roles are shown: only its address and its name are read
  group: { name: string; pulp_href: string };
  nonQueryParams?: string[];
  params: ParamType;
  updateParams: (params) => void;
}

const GroupDetailRoleManagement: FunctionComponent<IProps> = ({
  addAlert,
  canEdit,
  group,
  nonQueryParams,
  params,
  updateParams,
}) => {
  const [showAddRolesModal, setShowAddRolesModal] = useState<boolean>(false);
  const [selectedDeleteRole, setSelectedDeleteRole] = useState<GroupRole>(null);
  const [selectedRoles, setSelectedRoles] = useState<RoleType[]>([]);
  const [inputText, setInputText] = useState<string>(
    (params['role__icontains'] as string) || '',
  );

  const addRolesRequest = useAddGroupRoles();
  const removeRole = useRemoveGroupRole();

  // The roles of the group for the page, the order and the filter of the
  // address, and nothing else of it: another parameter of the address does not
  // read the roles again.
  const page = Number(single(params['page'])) || undefined;
  const pageSize = Number(single(params['page_size'])) || undefined;
  const sort = ParamHelper.validSortParams(
    single(params['sort']) ?? 'role',
    ['role'],
    'role',
  );
  const filter = single(params['role__icontains']);
  const listParams = useMemo<GroupRoleListParams>(
    () => ({
      page,
      page_size: pageSize,
      sort,
      role__icontains: filter,
    }),
    [page, pageSize, sort, filter],
  );
  const query = useGroupRoles(group.pulp_href, listParams);
  const roles = query.data?.results;
  const rolesItemCount = query.data?.count ?? 0;

  useEffect(() => {
    setInputText(filter || '');
  }, [filter]);

  // A failed read is reported once, whether it left the table with nothing to
  // show or only failed to refresh what is shown. The end of a session is not
  // a failure: the sign-in dialog explains it and the roles are read again
  // after signing in. A refusal with nothing to show is not an alert: the tab
  // says so itself.
  const failedStatus = query.isError ? requestErrorStatus(query.error) : null;
  const sessionEnded = query.isError && isSessionEnd(query.error);
  const refused = failedStatus === 403 && !query.data;
  const failed = query.isError && !sessionEnded && !refused;
  const alertedFailure = useRef(0);
  useEffect(() => {
    if (failed && alertedFailure.current !== query.errorUpdatedAt) {
      alertedFailure.current = query.errorUpdatedAt;
      addAlert(
        t`Permissions for group "${group.name}" could not be displayed.`,
        'danger',
        requestErrorDescription(query.error),
      );
    }
  }, [failed, query.errorUpdatedAt, query.error]);

  const deleteRole = async () => {
    if (!selectedDeleteRole || removeRole.isPending) {
      return;
    }
    const role = selectedDeleteRole;
    try {
      await removeRole.mutateAsync({
        href: group.pulp_href,
        role: role.pulp_href,
      });
      addAlert(
        t`Role "${role.role}" has been successfully removed.`,
        'success',
        t`All associated permissions under this role were removed.`,
      );
    } catch (err) {
      // The session ended: the role was not removed and nothing is repeated.
      if (!isSessionEnd(err)) {
        addAlert(
          t`Role "${role.role}" could not be deleted.`,
          'danger',
          requestErrorDescription(err),
        );
      }
    }
    setSelectedDeleteRole(null);
  };

  // One request per picked role, and each role is reported on its own.
  const saveRoles = async () => {
    if (addRolesRequest.isPending) {
      return;
    }
    const picked = selectedRoles;
    const outcomes = await addRolesRequest.mutateAsync({
      href: group.pulp_href,
      roles: picked.map((role) => role.name),
    });

    picked.forEach((role, i) => {
      const { error } = outcomes[i];
      if (error === null) {
        addAlert(
          t`Role ${role.name} has been successfully added to ${group.name}.`,
          'success',
        );
        return;
      }
      // cut off by the end of the session: kept below, not reported
      if (isSessionEnd(error)) {
        return;
      }
      const data = (
        error as { response?: { data?: { non_field_errors?: string[] } } }
      )?.response?.data;
      const errMessage =
        data?.non_field_errors?.length > 0
          ? data.non_field_errors[0]
          : requestErrorDescription(error);

      addAlert(
        t`Role ${role.name} could not be assigned to group ${group.name}.`,
        'danger',
        errMessage,
      );
    });

    // A session end keeps the wizard and the roles it cut off, so the user can
    // add them again after signing in.
    const cutOff = picked.filter((_, i) => isSessionEnd(outcomes[i].error));
    if (cutOff.length > 0) {
      setSelectedRoles(cutOff);
      return;
    }
    setShowAddRolesModal(false);
    setSelectedRoles([]);
  };

  const deleteModal = (
    <DeleteModal
      title={t`Delete role: ${selectedDeleteRole?.role}`}
      cancelAction={() => setSelectedDeleteRole(null)}
      deleteAction={deleteRole}
      spinner={removeRole.isPending}
      isDisabled={removeRole.isPending}
      data-cy='DeleteModal'
    >
      <Trans>
        You are about to remove <strong>{selectedDeleteRole?.role}</strong> from{' '}
        <strong>{group?.name}</strong>.
      </Trans>
      <br />
      {t`This will revoke all permissions associated with this role from the group.`}
    </DeleteModal>
  );

  const addRoles = canEdit && (
    <Button
      onClick={() => setShowAddRolesModal(true)}
      variant='primary'
      data-cy='add-roles'
    >
      {t`Add roles`}
    </Button>
  );

  if (!roles) {
    // a refused read is not a failure to retry: the user is told they may not
    // view the roles, with Pulp's own reason
    if (refused) {
      return (
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      );
    }
    if (failed && !query.isFetching) {
      return (
        <section className='pulp-section'>
          <ListErrorState
            title={t`Roles list could not be displayed.`}
            message={requestErrorDescription(query.error)}
            onRetry={() => query.refetch()}
          />
        </section>
      );
    }
    return (
      <section className='pulp-section'>
        <LoadingPage />
      </section>
    );
  }

  const noData =
    roles.length === 0 && !filterIsSet(params, ['role__icontains']);

  const noFilteredData =
    roles.length === 0 && filterIsSet(params, ['role__icontains']);

  const title = t`Add roles`;

  const isPreviewEnabled = selectedRoles.length !== 0;

  const steps = [
    {
      id: 0,
      name: t`Select role(s)`,
      children: (
        <SelectRoles
          assignedRoles={roles}
          selectedRoles={selectedRoles}
          onRolesUpdate={(roles) => setSelectedRoles(roles)}
        />
      ),
    },
    {
      id: 1,
      name: t`Preview`,
      children: <PreviewRoles group={group} selectedRoles={selectedRoles} />,
      isDisabled: !isPreviewEnabled,
    },
  ];

  const tableHeader = {
    headers: [
      {
        title: '',
        type: 'none',
        id: 'expander',
      },
      {
        title: t`Role`,
        type: 'alpha',
        id: 'role',
      },
      {
        title: t`Description`,
        type: 'none',
        id: 'description',
      },
      {
        title: '',
        type: 'none',
        id: 'kebab',
      },
    ],
  };

  return (
    <>
      {selectedDeleteRole && deleteModal}
      {showAddRolesModal && (
        <WizardModal
          steps={steps}
          title={title}
          onClose={() => {
            setShowAddRolesModal(false);
            setSelectedRoles([]);
          }}
          onSave={saveRoles}
        />
      )}
      {noData ? (
        <section className='pulp-section pulp-empty-state-box'>
          <EmptyStateNoData
            title={t`There are currently no roles assigned to this group.`}
            description={t`Please add a role by using the button below.`}
            button={addRoles}
          />
        </section>
      ) : (
        <section className='pulp-section'>
          <div className='pulp-toolbar'>
            <Toolbar>
              <ToolbarContent>
                <ToolbarGroup>
                  <ToolbarItem>
                    <CompoundFilter
                      inputText={inputText}
                      onChange={(p) => setInputText(p)}
                      updateParams={updateParams}
                      params={params}
                      filterConfig={[
                        {
                          id: 'role__icontains',
                          title: t`Name`,
                        },
                      ]}
                    />
                  </ToolbarItem>
                  <ToolbarItem>{addRoles}</ToolbarItem>
                </ToolbarGroup>
              </ToolbarContent>
            </Toolbar>

            <PulpPagination
              count={rolesItemCount}
              params={params}
              updateParams={updateParams}
              isTop
              isCompact
            />
          </div>

          <AppliedFilters
            style={{ marginTop: '16px' }}
            updateParams={(p) => updateParams(p)}
            params={params}
            ignoredParams={[
              'id',
              'page',
              'page_size',
              'sort',
              'tab',
              ...nonQueryParams,
            ]}
            niceNames={{
              role__icontains: t`Name`,
            }}
          />
          {!noFilteredData ? (
            <>
              <RoleListTable
                params={params}
                updateParams={updateParams}
                tableHeader={tableHeader}
              >
                {roles.map((role, i) => (
                  <ExpandableRow
                    key={i}
                    rowIndex={i}
                    expandableRowContent={
                      <PermissionCategories
                        permissions={role.permissions ?? []}
                        showCustom
                      />
                    }
                    data-cy={`RoleListTable-ExpandableRow-row-${role.role}`}
                  >
                    <Td>{role.role}</Td>
                    <Td>{translateLockedRole(role.role, role.description)}</Td>
                    <ListItemActions
                      kebabItems={[
                        canEdit && (
                          <DropdownItem
                            key='remove-role'
                            onClick={() => setSelectedDeleteRole(role)}
                          >
                            {t`Remove role`}
                          </DropdownItem>
                        ),
                      ]}
                    />
                  </ExpandableRow>
                ))}
              </RoleListTable>

              <div style={{ paddingTop: '24px', paddingBottom: '8px' }}>
                <PulpPagination
                  params={params}
                  updateParams={updateParams}
                  count={rolesItemCount}
                />
              </div>
            </>
          ) : (
            <EmptyStateFilter
              clearAllFilters={() => {
                updateParams(
                  ParamHelper.setParam(params, 'role__icontains', ''),
                );
              }}
            />
          )}
        </section>
      )}
    </>
  );
};
export default GroupDetailRoleManagement;
