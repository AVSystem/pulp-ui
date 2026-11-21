import { t } from '@lingui/core/macro';
import {
  AlertActionLink,
  Toolbar,
  ToolbarContent,
  ToolbarGroup,
  ToolbarItem,
} from '@patternfly/react-core';
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAppContext } from 'src/app-context';
import { Alert, type AlertType, Main, PulpPagination } from 'src/components';
import { useObjectPermissions } from 'src/entities/core/role-assignment/queries';
import type { Page } from 'src/entities/plugin/model';
import {
  isSessionEnd,
  requestErrorDescription,
  requestErrorReason,
  requestErrorStatus,
} from 'src/utilities/request-error';
import type { ColumnDef, FilterDef } from '../descriptor';
import {
  type ListParams,
  PAGE_SIZES,
  paramsOfAddress,
  searchOf,
} from './list-params';

// The pieces every plugin list is built from, whichever object it lists: what
// the address says, where the toolbar, the filters, the notices and the
// pagination sit, and what is shown when a read behind a column fails. A list
// brings its own rows, columns and reads.

// What the address says about the list the screen shows, and the way to change
// it. The fields the server can order by and the filters come from the
// descriptor's columns and filters, so an address can only ask for what the
// screen offers.
export function useListAddress(
  columns: readonly ColumnDef<never>[],
  filters: readonly FilterDef[],
) {
  const location = useLocation();
  const navigate = useNavigate();
  const options = useMemo(
    () => ({
      sortable: columns.flatMap(({ sortField }) =>
        sortField ? [sortField] : [],
      ),
      filters: filters.map(({ param }) => param),
    }),
    [columns, filters],
  );
  const params = useMemo(
    () => paramsOfAddress(location.search, options),
    [location.search, options],
  );
  const filterIsSet = options.filters.some(
    (param) => params[param] !== undefined,
  );

  return {
    params,
    filterIsSet,
    updateParams: (next: object) =>
      navigate({ search: searchOf(next as ListParams) }),
  };
}

// The rows to show of one read of a list. The server refuses a label
// expression it cannot read with a 400. That is an answer about the
// expression and not a failure of the list: the rows of the last result stay
// and the reason is shown at the filter.
export function useShownRows<Row>(
  query: {
    data: Page<Row> | undefined;
    isError: boolean;
    error: unknown;
    isPlaceholderData: boolean;
  },
  params: ListParams,
) {
  const refusedFilter =
    query.isError &&
    requestErrorStatus(query.error) === 400 &&
    params['pulp_label_select'] !== undefined;
  const lastShown = useRef<Page<Row> | undefined>(undefined);
  if (query.data && !query.isPlaceholderData) {
    lastShown.current = query.data;
  }
  const data =
    query.data ??
    (refusedFilter
      ? (lastShown.current ?? {
          count: 0,
          next: null,
          previous: null,
          results: [],
        })
      : undefined);
  const labelRefusal = refusedFilter
    ? (requestErrorReason(query.error) ?? t`The label filter was not accepted.`)
    : null;

  return { data, labelRefusal, lastShown };
}

// A failed read of rows already on screen keeps the rows and says so once.
export function useRereadAlert(
  query: {
    isRefetchError: boolean;
    errorUpdatedAt: number;
    error: unknown;
  },
  title: string,
  setAlerts: Dispatch<SetStateAction<AlertType[]>>,
) {
  const alerted = useRef(0);
  const failed =
    query.isRefetchError &&
    !isSessionEnd(query.error) &&
    requestErrorStatus(query.error) !== 403;

  useEffect(() => {
    if (failed && alerted.current !== query.errorUpdatedAt) {
      alerted.current = query.errorUpdatedAt;
      setAlerts((current) => [
        ...current,
        {
          variant: 'danger',
          title,
          description: requestErrorDescription(query.error),
        },
      ]);
    }
  }, [failed, query.errorUpdatedAt, query.error, title, setAlerts]);
}

interface Permits<Key extends string> {
  permits: (permission: Key, row: { pulp_href: string }) => boolean;
  // The notice a failed read of what the user may do is shown as, or null.
  notice: ReactNode;
}

// Whether the user may take an action on a row: the permission is held on
// every object, or, for a plugin whose roles can be granted on a single object,
// held on this one according to the roles the user has on single objects.
// Anything not known yet is no. A failed read of what the user may do says so
// once, with the one button that reads it again; nothing the user may not be
// confirmed to do is drawn meanwhile, and the failure is never taken for a
// refusal.
export function useRowPermits<Key extends string>({
  names,
  needed,
  objectRoles: byObject,
  rowsShown,
}: {
  // The permission name of each action key.
  names: Record<Key, string>;
  // The action keys the list may offer on a row.
  needed: readonly Key[];
  // Whether a role granted on a single object counts.
  objectRoles: boolean;
  rowsShown: boolean;
}): Permits<Key> {
  const {
    hasPermission,
    permissionsError,
    permissionsFailed,
    permissionsReady,
    retryPermissions,
  } = useAppContext();
  const needsObjectRoles =
    byObject &&
    permissionsReady &&
    needed.some((key) => !hasPermission(names[key]));
  // The roles on single objects are read behind the rows, and only for a user
  // who lacks a permission on every object.
  const roles = useObjectPermissions({
    enabled: rowsShown && needsObjectRoles,
  });

  return {
    permits: (key, row) =>
      hasPermission(names[key]) ||
      (needsObjectRoles && roles.can(row.pulp_href, names[key])),
    notice:
      permissionsFailed || (needsObjectRoles && roles.state === 'error') ? (
        <Alert
          isInline
          variant='warning'
          title={t`Your permissions could not be read`}
          actionLinks={
            <AlertActionLink
              onClick={permissionsFailed ? retryPermissions : roles.retry}
            >{t`Retry`}</AlertActionLink>
          }
          style={{ marginBottom: '16px' }}
        >
          {permissionsFailed ? requestErrorDescription(permissionsError) : null}
        </Alert>
      ) : null,
  };
}

// A column that failed to read is named once, above the table, with the one
// button that reads it again. The cells say it too, briefly.
export interface ColumnFailure {
  id: string;
  title: string;
  retry: () => void;
  description: ReactNode | undefined;
}

export const ColumnFailures = ({
  failures,
}: {
  failures: readonly ColumnFailure[];
}) => (
  <>
    {failures.map(({ id, title, retry, description }) => (
      <Alert
        key={id}
        isInline
        variant='warning'
        title={title}
        actionLinks={
          <AlertActionLink onClick={retry}>{t`Retry`}</AlertActionLink>
        }
        style={{ marginBottom: '16px' }}
      >
        {description}
      </Alert>
    ))}
  </>
);

interface LayoutProps {
  // The filter inputs, in the toolbar.
  filters: ReactNode;
  // The button that adds an object, or undefined when the user may not.
  addButton: ReactNode;
  // The bulk actions, as items of the toolbar; nothing when the user has none.
  bulk?: ReactNode;
  params: ListParams;
  updateParams: (next: object) => void;
  count: number;
  // The chips of the filters that are set.
  chips: ReactNode;
  // What is said above the table: notices, failures of a column.
  notices?: ReactNode;
  // The table, or the state that stands in its place.
  content: ReactNode;
  // Whether the table has rows, which decides whether the pagination under it
  // is drawn.
  hasRows: boolean;
}

// Where the parts of a list sit: the filters, the add button and the pagination
// in the toolbar, the chips of the filters in use, the notices, the table and
// the pagination under it.
export const ListLayout = ({
  filters,
  addButton,
  bulk,
  params,
  updateParams,
  count,
  chips,
  notices,
  content,
  hasRows,
}: LayoutProps) => (
  <Main>
    <section className='pulp-section'>
      <div className='pulp-toolbar'>
        <Toolbar>
          <ToolbarContent>
            {filters}
            {addButton ? (
              <ToolbarGroup>
                <ToolbarItem>{addButton}</ToolbarItem>
              </ToolbarGroup>
            ) : null}
            {bulk ? <ToolbarGroup>{bulk}</ToolbarGroup> : null}
          </ToolbarContent>
        </Toolbar>
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={count}
          perPageOptions={PAGE_SIZES}
          isTop
        />
      </div>
      <div>{chips}</div>
      {notices}
      {content}
      {hasRows ? (
        <PulpPagination
          params={params}
          updateParams={updateParams}
          count={count}
          perPageOptions={PAGE_SIZES}
        />
      ) : null}
    </section>
  </Main>
);
