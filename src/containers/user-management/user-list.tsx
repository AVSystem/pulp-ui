import { t } from '@lingui/core/macro';
import {
  Button,
  DropdownItem,
  Label,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import tableStyles from '@patternfly/react-styles/css/components/Table/table.mjs';
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
  DateComponent,
  DeleteUserModal,
  EmptyStateFilter,
  EmptyStateNoData,
  InsufficientPermissions,
  LabelGroup,
  ListItemActions,
  LoadingSpinner,
  Main,
  PulpPagination,
  SortTable,
  Table,
  closeAlert,
} from 'src/components';
import { ListErrorState } from 'src/components/list-error-state';
import { userUrlId } from 'src/entities/core/user/href';
import { DEFAULT_PAGE_SIZE, type User } from 'src/entities/core/user/model';
import { useUsers } from 'src/entities/core/user/queries';
import { Paths, formatPath } from 'src/paths';
import { filterIsSet } from 'src/utilities/filter-is-set';
import { ParamHelper } from 'src/utilities/param-helper';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorDetail,
  requestErrorStatus,
} from 'src/utilities/request-error';

const DEFAULT_SORT = 'username';

const FILTERS = [
  'username__contains',
  'first_name__contains',
  'last_name__contains',
  'email__contains',
];

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

const UserList = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission } = useAppContext();

  const params = useMemo(
    () => paramsOfAddress(location.search),
    [location.search],
  );

  const query = useUsers({
    page: params['page'],
    page_size: params['page_size'],
    sort: single(params['sort']),
    username__contains: single(params['username__contains']),
    first_name__contains: single(params['first_name__contains']),
    last_name__contains: single(params['last_name__contains']),
    email__contains: single(params['email__contains']),
  });

  const [alerts, setAlerts] = useState<AlertType[]>([]);
  const [inputText, setInputText] = useState('');
  const [deleteUser, setDeleteUser] = useState<User | null>(null);

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
          title: t`Users list could not be displayed.`,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [rereadFailed, query.errorUpdatedAt, query.error]);

  const updateParams = (next) =>
    navigate({ search: '?' + ParamHelper.getQueryString(next) });

  const header = <BaseHeader title={t`Users`} />;

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

  const renderTable = () => {
    if (failed) {
      return (
        <ListErrorState
          title={t`Users list could not be displayed.`}
          message={requestErrorDescription(query.error)}
          onRetry={() => query.refetch()}
        />
      );
    }

    if (items.length === 0) {
      return filterIsSet(params, FILTERS) ? (
        <EmptyStateFilter />
      ) : (
        <EmptyStateNoData
          title={t`No users yet`}
          description={t`Users will appear once created`}
          button={
            hasPermission('auth.add_user') && (
              <Link to={formatPath(Paths.core.user.create)}>
                <Button variant={'primary'}>{t`Create`}</Button>
              </Link>
            )
          }
        />
      );
    }

    const sortTableOptions = {
      headers: [
        {
          title: t`Username`,
          type: 'alpha',
          id: 'username',
        },
        {
          title: t`First name`,
          type: 'alpha',
          id: 'first_name',
          className: tableStyles.modifiers.wrap,
        },
        {
          title: t`Last name`,
          type: 'alpha',
          id: 'last_name',
          className: tableStyles.modifiers.wrap,
        },
        {
          title: t`Email`,
          type: 'alpha',
          id: 'email',
        },
        {
          id: 'groups',
          title: t`Groups`,
          type: 'none',
        },
        {
          title: t`Created`,
          type: 'numeric',
          id: 'date_joined',
        },
        {
          title: '',
          type: 'none',
          id: 'kebab',
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
        <Tbody>{items.map((user) => renderTableRow(user))}</Tbody>
      </Table>
    );
  };

  const renderTableRow = (user: User) => {
    const dropdownItems = [];
    const urlId = userUrlId(user.pulp_href);

    if (hasPermission('auth.change_user')) {
      dropdownItems.push(
        <DropdownItem
          key='edit'
          onClick={() =>
            navigate(formatPath(Paths.core.user.edit, { user_id: urlId }))
          }
        >
          {t`Edit`}
        </DropdownItem>,
      );
    }

    if (hasPermission('auth.delete_user')) {
      dropdownItems.push(
        <DropdownItem key='delete' onClick={() => setDeleteUser(user)}>
          {t`Delete`}
        </DropdownItem>,
      );
    }

    return (
      <Tr data-cy={`UserList-row-${user.username}`} key={user.pulp_href}>
        <Td>
          <Link to={formatPath(Paths.core.user.detail, { user_id: urlId })}>
            {user.username}
          </Link>
        </Td>
        <Td>{user.first_name}</Td>
        <Td>{user.last_name}</Td>
        <Td>{user.email}</Td>
        <Td>
          <LabelGroup>
            {(user.groups ?? []).map((g) => (
              <Label key={g.id}>{g.name}</Label>
            ))}
          </LabelGroup>
        </Td>
        <Td>
          <DateComponent date={user.date_joined} />
        </Td>
        <ListItemActions kebabItems={dropdownItems} />
      </Tr>
    );
  };

  return (
    <>
      {alertList}
      <DeleteUserModal
        isOpen={deleteUser !== null}
        closeModal={() => setDeleteUser(null)}
        user={deleteUser ?? undefined}
        addAlert={(text, variant, description = undefined) =>
          addAlert({ title: text, variant, description })
        }
      />
      {header}
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
                          id: 'username__contains',
                          title: t`Username`,
                        },
                        {
                          id: 'first_name__contains',
                          title: t`First name`,
                        },
                        {
                          id: 'last_name__contains',
                          title: t`Last name`,
                        },
                        {
                          id: 'email__contains',
                          title: t`Email`,
                        },
                      ]}
                    />
                  </ToolbarItem>
                </ToolbarGroup>
                {hasPermission('auth.add_user') ? (
                  <ToolbarGroup>
                    <ToolbarItem>
                      <Link to={formatPath(Paths.core.user.create)}>
                        <Button>{t`Create`}</Button>
                      </Link>
                    </ToolbarItem>
                  </ToolbarGroup>
                ) : null}
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
                username__contains: t`Username`,
                first_name__contains: t`First name`,
                last_name__contains: t`Last name`,
                email__contains: t`Email`,
              }}
            />
          </div>
          {loading ? <LoadingSpinner /> : renderTable()}

          <PulpPagination
            params={params}
            updateParams={updateParams}
            count={query.data?.count ?? 0}
          />
        </section>
      </Main>
    </>
  );
};

export default UserList;
