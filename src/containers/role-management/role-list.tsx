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
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import {
  AlertList,
  type AlertType,
  AppliedFilters,
  BaseHeader,
  CompoundFilter,
  DateComponent,
  DeleteModal,
  EmptyStateFilter,
  EmptyStateNoData,
  ExpandableRow,
  InsufficientPermissions,
  ListItemActions,
  LoadingSpinner,
  Main,
  PermissionCategories,
  PulpPagination,
  RoleListTable,
  Tooltip,
  closeAlert,
} from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { roleUrlId } from 'src/entities/core/role/href';
import { DEFAULT_PAGE_SIZE, type Role } from 'src/entities/core/role/model';
import { useDeleteRole, useRoles } from 'src/entities/core/role/queries';
import { Paths, formatPath } from 'src/paths';
import { filterIsSet } from 'src/utilities/filter-is-set';
import { ParamHelper } from 'src/utilities/param-helper';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';
import { translateLockedRole } from 'src/utilities/translate-locked-role';

const DEFAULT_SORT = 'name';

const FILTERS = ['name__icontains', 'locked'];

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

// The built-in filter of the address: only the two values the filter offers
// mean something, anything else asks for both kinds of role.
function lockedOfAddress(value: unknown): boolean | undefined {
  const text = single(value);
  return text === 'true' ? true : text === 'false' ? false : undefined;
}

const RoleList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAppContext();

  const params = useMemo(
    () => paramsOfAddress(location.search),
    [location.search],
  );

  const query = useRoles({
    page: params['page'],
    page_size: params['page_size'],
    sort: single(params['sort']),
    name__icontains: single(params['name__icontains']),
    locked: lockedOfAddress(params['locked']),
  });
  const deleteRole = useDeleteRole();

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [inputText, setInputText] = useState('');
  const [roleToDelete, setRoleToDelete] = useState<Role | null>(null);

  const addAlert = (alert: AlertType) =>
    setAlerts((current) => [...current, alert]);

  const roles = useMemo(() => query.data?.results ?? [], [query.data]);

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
          title: t`Roles list could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  const updateParams = (next) =>
    navigate({ search: '?' + ParamHelper.getQueryString(next) });

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
        <BaseHeader title={t`Roles`} />
        <InsufficientPermissions detail={requestErrorDetail(query.error)} />
      </>
    );
  }

  const failed =
    query.isError && !sessionEnded && !query.data && !query.isFetching;
  const loading = !query.data && !failed;
  const noData =
    !!query.data && roles.length === 0 && !filterIsSet(params, FILTERS);

  const confirmDelete = async (role: Role) => {
    if (deleteRole.isPending) {
      return;
    }
    try {
      await deleteRole.mutateAsync({ href: role.pulp_href });
    } catch (error) {
      // The session ended: nothing was deleted and nothing is repeated; the
      // dialog stays and the list is read again after signing in.
      if (isSessionEnd(error)) {
        return;
      }
      addAlert({
        variant: 'danger',
        title: t`Role "${role.name}" could not be deleted.`,
        description: requestErrorDescription(error),
      });
      setRoleToDelete(null);
      return;
    }
    addAlert({
      variant: 'success',
      title: t`Role "${role.name}" has been successfully deleted.`,
    });
    setRoleToDelete(null);
  };

  const addRoles = (
    <Link to={formatPath(Paths.core.role.create)}>
      <Button variant={'primary'}>{t`Add roles`}</Button>
    </Link>
  );

  const tableHeader = [
    {
      title: '',
      type: 'none',
      id: 'expander',
    },
    {
      title: t`Role name`,
      type: 'alpha',
      id: 'name',
    },
    {
      title: t`Description`,
      type: 'none',
      id: 'description',
    },
    {
      title: t`Created`,
      type: 'number',
      id: 'pulp_created',
    },
    {
      title: t`Editable`,
      type: 'none',
      id: 'locked',
    },
    {
      title: '',
      type: 'none',
      id: 'kebab',
    },
  ];

  // Only staff hold these permissions, so the actions are in practice for
  // staff; Pulp decides every request.
  const renderDropdownItems = (role: Role) => {
    const locked = !!role.locked;
    const urlId = roleUrlId(role.pulp_href);

    const editItem = (
      <DropdownItem
        key='edit'
        isDisabled={locked}
        onClick={() =>
          navigate(formatPath(Paths.core.role.edit, { role: urlId }))
        }
      >
        {t`Edit`}
      </DropdownItem>
    );
    const deleteItem = (
      <DropdownItem
        key='delete'
        isDisabled={locked}
        onClick={() => setRoleToDelete(role)}
      >
        {t`Delete`}
      </DropdownItem>
    );

    return [
      hasPermission('core.change_role') &&
        urlId !== null &&
        (locked ? (
          <Tooltip key='edit' content={t`Built-in roles cannot be edited.`}>
            {editItem}
          </Tooltip>
        ) : (
          editItem
        )),
      hasPermission('core.delete_role') &&
        (locked ? (
          <Tooltip key='delete' content={t`Built-in roles cannot be deleted.`}>
            {deleteItem}
          </Tooltip>
        ) : (
          deleteItem
        )),
    ];
  };

  const renderTable = () => {
    if (failed) {
      return (
        <ListErrorState
          title={t`Roles list could not be displayed.`}
          message={requestErrorDescription(query.error)}
          onRetry={() => query.refetch()}
        />
      );
    }

    if (roles.length === 0) {
      return <EmptyStateFilter />;
    }

    return (
      <RoleListTable
        params={params}
        updateParams={updateParams}
        tableHeader={{ headers: tableHeader }}
      >
        {roles.map((role, i) => (
          <ExpandableRow
            key={role.pulp_href}
            expandableRowContent={
              <PermissionCategories
                permissions={role.permissions ?? []}
                showCustom
              />
            }
            data-cy={`RoleListTable-ExpandableRow-row-${role.name}`}
            colSpan={6}
            rowIndex={i}
          >
            <Td data-cy='name-field'>{role.name}</Td>
            <Td>
              {translateLockedRole(role.name, role.description ?? undefined)}
            </Td>
            <Td>
              <DateComponent date={role.pulp_created ?? undefined} />
            </Td>

            <Td>
              {role.locked ? (
                <Tooltip
                  content={t`Built-in roles cannot be edited or deleted.`}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>{t`Built-in`}</span>
                </Tooltip>
              ) : (
                t`Editable`
              )}
            </Td>
            <ListItemActions kebabItems={renderDropdownItems(role)} />
          </ExpandableRow>
        ))}
      </RoleListTable>
    );
  };

  return (
    <>
      {alertList}
      {roleToDelete && (
        <DeleteModal
          cancelAction={() => setRoleToDelete(null)}
          deleteAction={() => confirmDelete(roleToDelete)}
          isDisabled={deleteRole.isPending}
          spinner={deleteRole.isPending}
          title={t`Delete role?`}
          data-cy='DeleteModal'
        >
          <Trans>
            <p>
              Role <b>{roleToDelete.name}</b> will be permanently deleted.
            </p>
            <p>
              This will also remove all associated permissions under this role.
            </p>
          </Trans>
        </DeleteModal>
      )}
      <BaseHeader title={t`Roles`} />
      {loading ? (
        <Main>
          <LoadingSpinner />
        </Main>
      ) : noData ? (
        <EmptyStateNoData
          title={t`There are currently no roles`}
          description={t`Please add a role by using the button below.`}
          button={addRoles}
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
                            title: t`Role name`,
                          },

                          {
                            id: 'locked',
                            title: t`Editable`,
                            inputType: 'select',
                            options: [
                              {
                                id: 'true',
                                title: t`Built-in`,
                              },
                              {
                                id: 'false',
                                title: t`Editable`,
                              },
                            ],
                          },
                        ]}
                      />
                    </ToolbarItem>
                  </ToolbarGroup>
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
                ignoredParams={['page_size', 'page', 'sort', 'ordering']}
                niceValues={{
                  locked: { true: t`Built-in`, false: t`Editable` },
                }}
                niceNames={{
                  locked: t`Editable`,
                  name__icontains: t`Role name`,
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

export default RoleList;
